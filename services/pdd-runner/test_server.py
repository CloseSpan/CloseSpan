import hashlib
import json
import os
import unittest
from subprocess import CompletedProcess, TimeoutExpired
from unittest import mock

os.environ.setdefault("CLOSESPAN_CALLBACK_ORIGIN", "https://closespan.example")

import server


def profile_config():
    return {
        "schemaVersion": 1,
        "language": "typescript",
        "framework": "Next.js",
        "packageManager": "pnpm",
        "runtimeVersion": "22",
        "workingDirectory": "apps/web",
        "installCommands": ["pnpm install --frozen-lockfile --ignore-scripts"],
        "buildCommands": ["pnpm run build"],
        "testCommands": ["pnpm test"],
        "typecheckCommands": ["pnpm run typecheck"],
        "permittedPaths": ["apps/web/**"],
        "tenkiImage": None,
        "tenkiSnapshotId": None,
        "cpuCores": 2,
        "memoryMb": 4096,
        "allowInbound": False,
        "allowOutbound": False,
        "maxDurationMs": 1800000,
        "idleTimeoutMinutes": 2,
    }


def job():
    config = profile_config()
    content_hash = hashlib.sha256(
        json.dumps(config, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()
    profile_id = "11111111-1111-4111-8111-111111111111"
    return {
        "schemaVersion": 2,
        "orgId": "org-1",
        "verificationId": "22222222-2222-4222-8222-222222222222",
        "repository": "acme/platform",
        "baseSha": "a" * 40,
        "promptId": "33333333-3333-4333-8333-333333333333",
        "promptHash": "b" * 64,
        "pddPrompt": "Generate a test.",
        "pddVersion": "0.0.309",
        "executionProfileId": profile_id,
        "executionProfileHash": content_hash,
        "executionProfileSnapshot": {
            "profileId": profile_id,
            "version": 3,
            "source": "confirmed",
            "repository": "acme/platform",
            "workspaceRoot": "apps/web",
            "contentHash": content_hash,
            "config": config,
        },
        "budgetUsd": 0.25,
        "repositoryArchiveUrl": "https://codeload.github.com/acme/platform/tar.gz/" + "a" * 40,
        "permittedPaths": ["apps/web/src/**", "apps/web/tests/**"],
        "requiredCommands": ["pnpm test"],
        "suspectedFiles": ["apps/web/src/export.ts"],
        "callbackUrl": "https://closespan.example/api/internal/pdd-verifications/22222222-2222-4222-8222-222222222222",
    }


class PddJobV2ValidationTest(unittest.TestCase):
    def setUp(self):
        self.version = mock.patch.object(server, "PDD_CLI_VERSION", "0.0.309")
        self.version.start()

    def tearDown(self):
        self.version.stop()

    def test_accepts_profile_bound_v2_job(self):
        self.assertEqual(server.validate_job(job())["schemaVersion"], 2)

    def test_rejects_job_for_another_pdd_version(self):
        value = job()
        value["pddVersion"] = "0.0.306"
        with self.assertRaisesRegex(ValueError, "installed runner version"):
            server.validate_job(value)

    def test_rejects_legacy_job(self):
        value = job()
        value["schemaVersion"] = 1
        with self.assertRaisesRegex(ValueError, "Invalid PDD job"):
            server.validate_job(value)

    def test_rejects_profile_hash_drift(self):
        value = job()
        value["executionProfileSnapshot"]["config"]["cpuCores"] = 8
        with self.assertRaisesRegex(ValueError, "hash does not match"):
            server.validate_job(value)

    def test_rejects_inactive_detected_profile(self):
        value = job()
        value["executionProfileSnapshot"]["source"] = "detected"
        with self.assertRaisesRegex(ValueError, "inactive detected profile"):
            server.validate_job(value)

    def test_rejects_ticket_path_or_command_broader_than_profile(self):
        value = job()
        value["permittedPaths"] = ["packages/shared/**"]
        with self.assertRaisesRegex(ValueError, "path is broader"):
            server.validate_job(value)

        value = job()
        value["requiredCommands"] = ["pnpm deploy"]
        with self.assertRaisesRegex(ValueError, "command is not allowed"):
            server.validate_job(value)

    def test_rejects_profile_for_another_repository(self):
        value = job()
        value["executionProfileSnapshot"]["repository"] = "acme/other"
        with self.assertRaisesRegex(ValueError, "another repository"):
            server.validate_job(value)

    def test_rejects_network_or_resource_shape_drift(self):
        value = job()
        value["executionProfileSnapshot"]["config"]["allowOutbound"] = "false"
        with self.assertRaisesRegex(ValueError, "network policy"):
            server.validate_job(value)


class PddVersionDetectionTest(unittest.TestCase):
    def test_detects_and_normalizes_the_installed_cli_version(self):
        completed = CompletedProcess(["pdd", "--version"], 0, "pdd, version v0.0.309\n", "")
        with mock.patch.object(server.subprocess, "run", return_value=completed) as run:
            self.assertEqual(server.detect_pdd_cli_version(), "0.0.309")
        run.assert_called_once_with(
            ["pdd", "--version"], capture_output=True, text=True,
            timeout=10, check=False,
        )

    def test_accepts_version_output_written_to_stderr(self):
        completed = CompletedProcess(["pdd", "--version"], 0, "", "pdd 0.0.309\n")
        with mock.patch.object(server.subprocess, "run", return_value=completed):
            self.assertEqual(server.detect_pdd_cli_version(), "0.0.309")

    def test_rejects_failed_or_ambiguous_version_detection(self):
        failed = CompletedProcess(["pdd", "--version"], 1, "", "failed")
        with mock.patch.object(server.subprocess, "run", return_value=failed):
            with self.assertRaisesRegex(RuntimeError, "exited unsuccessfully"):
                server.detect_pdd_cli_version()

        ambiguous = CompletedProcess(["pdd", "--version"], 0, "pdd 0.0.309 python 3.12.11", "")
        with mock.patch.object(server.subprocess, "run", return_value=ambiguous):
            with self.assertRaisesRegex(RuntimeError, "exactly one semantic version"):
                server.detect_pdd_cli_version()

        with mock.patch.object(server.subprocess, "run", side_effect=TimeoutExpired("pdd", 10)):
            with self.assertRaisesRegex(RuntimeError, "Could not execute"):
                server.detect_pdd_cli_version()

        embedded = CompletedProcess(["pdd", "--version"], 0, "not-a-version0.0.309garbage", "")
        with mock.patch.object(server.subprocess, "run", return_value=embedded):
            with self.assertRaisesRegex(RuntimeError, "exactly one semantic version"):
                server.detect_pdd_cli_version()

    def test_health_payload_attests_the_actual_version(self):
        with (
            mock.patch.object(server, "SHARED_SECRET", b"secret"),
            mock.patch.object(server, "CALLBACK_ORIGIN", "https://closespan.example"),
            mock.patch.object(server, "PDD_CLI_VERSION", "0.0.309"),
        ):
            self.assertEqual(server.health_payload(), {
                "status": "ok",
                "pddVersion": "0.0.309",
            })


if __name__ == "__main__":
    unittest.main()
