import hashlib
import hmac
import io
import json
import os
import pathlib
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


def profile_config_v2():
    return {
        **profile_config(),
        "schemaVersion": 2,
        "installCommands": [
            "pnpm install --frozen-lockfile --ignore-scripts",
            "pnpm exec playwright install chromium",
            server.BROWSER_PREFLIGHT_COMMAND,
        ],
        "allowInbound": True,
        "allowOutbound": True,
        "automaticInstall": True,
        "automaticBuild": True,
        "publicEnvironment": [
            {"name": "APP_MODE", "value": "production-canary"},
        ],
        "secretBindings": [{
            "envName": "PACKAGE_REGISTRY_AUTH",
            "secretId": "44444444-4444-4444-8444-444444444444",
            "secretVersion": 3,
            "exposure": "setup",
        }],
        "startCommand": "pnpm start",
        "applicationPort": 4173,
        "healthCheckPath": "/health",
        "healthCheckTimeoutMs": 90000,
        "previewEnabled": True,
        "previewTtlMs": 120000,
        "runtimeTools": {"http": True, "browser": True, "logs": True},
    }


def job(config=None):
    config = config or profile_config()
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

    def test_accepts_signed_job_with_execution_profile_schema_v1(self):
        self.assertEqual(server.validate_job(job())["schemaVersion"], 2)

    def test_accepts_execution_profile_schema_v2_with_runtime_capabilities(self):
        value = server.validate_job(job(profile_config_v2()))
        config = value["executionProfileSnapshot"]["config"]
        self.assertEqual(config["schemaVersion"], 2)
        self.assertTrue(config["automaticInstall"])
        self.assertEqual(config["secretBindings"][0]["exposure"], "setup")
        self.assertEqual(config["runtimeTools"], {
            "http": True,
            "browser": True,
            "logs": True,
        })

    def test_rejects_v2_missing_or_extra_configuration_keys(self):
        value = job(profile_config_v2())
        del value["executionProfileSnapshot"]["config"]["previewTtlMs"]
        with self.assertRaisesRegex(ValueError, "configuration version"):
            server.validate_job(value)

        value = job(profile_config_v2())
        value["executionProfileSnapshot"]["config"]["secretValue"] = "must-not-enter-runner"
        with self.assertRaisesRegex(ValueError, "configuration version"):
            server.validate_job(value)

    def test_rejects_secret_binding_values_and_invalid_metadata(self):
        value = job(profile_config_v2())
        value["executionProfileSnapshot"]["config"]["secretBindings"][0]["value"] = "plaintext"
        with self.assertRaisesRegex(ValueError, "metadata only"):
            server.validate_job(value)

        for field, invalid, message in (
            ("secretId", "not-a-uuid", "binding ID"),
            ("secretVersion", 0, "binding version"),
            ("exposure", "agent", "binding exposure"),
        ):
            value = job(profile_config_v2())
            value["executionProfileSnapshot"]["config"]["secretBindings"][0][field] = invalid
            with self.subTest(field=field), self.assertRaisesRegex(ValueError, message):
                server.validate_job(value)

    def test_rejects_duplicate_or_conflicting_environment_names(self):
        value = job(profile_config_v2())
        value["executionProfileSnapshot"]["config"]["publicEnvironment"].append({
            "name": "APP_MODE", "value": "duplicate",
        })
        with self.assertRaisesRegex(ValueError, "Duplicate public"):
            server.validate_job(value)

        value = job(profile_config_v2())
        value["executionProfileSnapshot"]["config"]["publicEnvironment"][0]["name"] = "PACKAGE_REGISTRY_AUTH"
        with self.assertRaisesRegex(ValueError, "both public and secret"):
            server.validate_job(value)

        value = job(profile_config_v2())
        value["executionProfileSnapshot"]["config"]["secretBindings"].append({
            **value["executionProfileSnapshot"]["config"]["secretBindings"][0],
            "secretId": "55555555-5555-4555-8555-555555555555",
        })
        with self.assertRaisesRegex(ValueError, "Duplicate setup secret"):
            server.validate_job(value)

    def test_rejects_reserved_or_secret_looking_public_environment(self):
        value = job(profile_config_v2())
        value["executionProfileSnapshot"]["config"]["publicEnvironment"][0]["name"] = "PORT"
        with self.assertRaisesRegex(ValueError, "reserved"):
            server.validate_job(value)

        value = job(profile_config_v2())
        value["executionProfileSnapshot"]["config"]["publicEnvironment"][0] = {
            "name": "DATABASE_URL",
            "value": "development",
        }
        with self.assertRaisesRegex(ValueError, "looks like a secret"):
            server.validate_job(value)

        value = job(profile_config_v2())
        value["executionProfileSnapshot"]["config"]["publicEnvironment"][0]["value"] = (
            "Bearer definitely-not-public"
        )
        with self.assertRaisesRegex(ValueError, "secret-looking value"):
            server.validate_job(value)

    def test_rejects_automatic_setup_without_commands(self):
        value = job(profile_config_v2())
        value["executionProfileSnapshot"]["config"]["installCommands"] = []
        with self.assertRaisesRegex(ValueError, "automatic install"):
            server.validate_job(value)

        value = job(profile_config_v2())
        value["executionProfileSnapshot"]["config"]["buildCommands"] = []
        with self.assertRaisesRegex(ValueError, "automatic build"):
            server.validate_job(value)

    def test_rejects_partial_or_invalid_application_configuration(self):
        value = job(profile_config_v2())
        value["executionProfileSnapshot"]["config"]["applicationPort"] = None
        with self.assertRaisesRegex(ValueError, "requires start command, port, and health"):
            server.validate_job(value)

        for field, invalid, message in (
            ("applicationPort", 80, "applicationPort"),
            ("healthCheckPath", "//other-host/health", "healthCheckPath"),
            ("healthCheckTimeoutMs", 1000, "healthCheckTimeoutMs"),
            ("previewTtlMs", 1000, "previewTtlMs"),
        ):
            value = job(profile_config_v2())
            value["executionProfileSnapshot"]["config"][field] = invalid
            with self.subTest(field=field), self.assertRaisesRegex(ValueError, message):
                server.validate_job(value)

    def test_rejects_invalid_runtime_tools_and_preview_networking(self):
        value = job(profile_config_v2())
        value["executionProfileSnapshot"]["config"]["runtimeTools"]["shell"] = True
        with self.assertRaisesRegex(ValueError, "runtimeTools"):
            server.validate_job(value)

        value = job(profile_config_v2())
        value["executionProfileSnapshot"]["config"]["allowInbound"] = False
        with self.assertRaisesRegex(ValueError, "preview requires inbound"):
            server.validate_job(value)

        value = job(profile_config_v2())
        value["executionProfileSnapshot"]["config"]["secretBindings"][0]["exposure"] = "runtime"
        with self.assertRaisesRegex(ValueError, "preview cannot be combined"):
            server.validate_job(value)

    def test_rejects_outbound_runtime_or_test_secrets(self):
        for exposure in ("runtime", "test"):
            value = job(profile_config_v2())
            value["executionProfileSnapshot"]["config"]["previewEnabled"] = False
            value["executionProfileSnapshot"]["config"]["secretBindings"][0]["exposure"] = exposure
            with self.subTest(exposure=exposure), self.assertRaisesRegex(ValueError, "outbound execution"):
                server.validate_job(value)

    def test_rejects_browser_without_exact_provisioning_contract(self):
        value = job(profile_config_v2())
        value["executionProfileSnapshot"]["config"]["installCommands"].remove(
            server.BROWSER_PREFLIGHT_COMMAND
        )
        with self.assertRaisesRegex(ValueError, "exact Chromium launch preflight"):
            server.validate_job(value)

        value = job(profile_config_v2())
        value["executionProfileSnapshot"]["config"]["installCommands"].remove(
            "pnpm exec playwright install chromium"
        )
        with self.assertRaisesRegex(ValueError, "exact Chromium install command"):
            server.validate_job(value)

        value = job(profile_config_v2())
        value["executionProfileSnapshot"]["config"]["allowOutbound"] = False
        with self.assertRaisesRegex(ValueError, "requires outbound access"):
            server.validate_job(value)

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
            timeout=server.PDD_VERSION_TIMEOUT_SECONDS, check=False,
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

        with mock.patch.object(
            server.subprocess,
            "run",
            side_effect=TimeoutExpired("pdd", server.PDD_VERSION_TIMEOUT_SECONDS),
        ):
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
                "executionMode": server.PDD_EXECUTION_MODE,
                "localFallbackEnabled": server.PDD_CLOUD_FALLBACK_ENABLED,
                "executionProfileSchemaVersions": [1, 2],
                "activeJobs": 0,
                "queuedJobs": 0,
                "runConcurrency": server.RUN_CONCURRENCY,
                "maxQueuedJobs": server.MAX_QUEUED_JOBS,
            })


class PddHandlerV2ValidationTest(unittest.TestCase):
    def setUp(self):
        server.ACTIVE_JOBS = 0
        server.QUEUED_JOBS = 0
        self.secret = b"handler-test-secret"
        self.shared_secret = mock.patch.object(server, "SHARED_SECRET", self.secret)
        self.callback = mock.patch.object(
            server, "CALLBACK_ORIGIN", "https://closespan.example"
        )
        self.version = mock.patch.object(server, "PDD_CLI_VERSION", "0.0.309")
        self.execute = mock.patch.object(server, "execute")
        self.shared_secret.start()
        self.callback.start()
        self.version.start()
        self.execute_mock = self.execute.start()

    def tearDown(self):
        server.ACTIVE_JOBS = 0
        server.QUEUED_JOBS = 0
        self.execute.stop()
        self.version.stop()
        self.callback.stop()
        self.shared_secret.stop()

    def handler(self, *, path, body=b"", headers=None):
        handler = object.__new__(server.Handler)
        handler.path = path
        handler.headers = headers or {}
        handler.rfile = io.BytesIO(body)
        handler.wfile = io.BytesIO()
        handler.send_response = mock.Mock()
        handler.send_header = mock.Mock()
        handler.end_headers = mock.Mock()
        handler.send_error = mock.Mock()
        return handler

    def post(self, payload):
        body = json.dumps(payload, separators=(",", ":")).encode()
        signature = hmac.new(self.secret, body, hashlib.sha256).hexdigest()
        handler = self.handler(
            path="/verifications",
            body=body,
            headers={
                "content-type": "application/json",
                "content-length": str(len(body)),
                "x-closespan-signature": signature,
            },
        )

        class ImmediateThread:
            def __init__(self, *, target, args, daemon):
                self.target = target
                self.args = args

            def start(self):
                self.target(*self.args)

        with mock.patch.object(server.threading, "Thread", ImmediateThread):
            handler.do_POST()
        if handler.send_error.called:
            return handler.send_error.call_args.args[0], handler.wfile.getvalue()
        return handler.send_response.call_args.args[0], handler.wfile.getvalue()

    def test_health_attests_supported_profile_schema_versions(self):
        handler = self.handler(path="/health")
        handler.do_GET()
        self.assertEqual(handler.send_response.call_args.args[0], 200)
        payload = json.loads(handler.wfile.getvalue())
        self.assertEqual(payload["executionProfileSchemaVersions"], [1, 2])

    def test_signed_valid_v2_post_is_accepted(self):
        payload = job(profile_config_v2())
        status, body = self.post(payload)
        self.assertEqual(status, 202)
        self.assertEqual(json.loads(body), {
            "accepted": True,
            "verificationId": payload["verificationId"],
        })
        self.execute_mock.assert_called_once_with(payload)

    def test_queue_capacity_is_bounded(self):
        payload = job(profile_config_v2())
        server.ACTIVE_JOBS = server.RUN_CONCURRENCY
        try:
            with mock.patch.object(server, "MAX_QUEUED_JOBS", 0):
                status, _ = self.post(payload)
            self.assertEqual(status, 429)
            self.assertEqual(server.QUEUED_JOBS, 0)
        finally:
            server.ACTIVE_JOBS = 0

    def test_signed_invalid_v2_post_is_rejected_before_execution(self):
        payload = job(profile_config_v2())
        payload["executionProfileSnapshot"]["config"]["secretBindings"][0][
            "value"
        ] = "plaintext-must-not-reach-pdd"
        status, _ = self.post(payload)
        self.assertEqual(status, 400)
        self.execute_mock.assert_not_called()


class PddExecutionModeTests(unittest.TestCase):
    def test_cloud_environment_uses_pddc_and_strips_direct_provider_keys(self):
        with (
            mock.patch.object(server, "PDD_REFRESH_TOKEN", "durable-refresh-token"),
            mock.patch.dict(
                os.environ,
                {
                    "PDD_JWT_TOKEN": "signed-token",
                    "PDD_REFRESH_TOKEN": "durable-refresh-token",
                    "OPENAI_API_KEY": "direct-openai-key",
                    "ANTHROPIC_API_KEY": "direct-anthropic-key",
                    "PDD_FORCE_LOCAL": "1",
                },
                clear=False,
            ),
        ):
            environment = server.pdd_environment("cloud", 0.25)

        self.assertEqual(environment["PDD_CLOUD_RUN"], "true")
        self.assertEqual(environment["PDD_COMMAND_MAX_COST_USD"], "0.250000")
        self.assertEqual(environment["PDD_NO_INTERACTIVE"], "1")
        self.assertNotIn("PDD_FORCE_LOCAL", environment)
        self.assertNotIn("PDD_REFRESH_TOKEN", environment)
        self.assertNotIn("PDD_JWT_TOKEN", environment)
        self.assertNotIn("OPENAI_API_KEY", environment)
        self.assertNotIn("ANTHROPIC_API_KEY", environment)

    def test_local_environment_is_explicit_and_keeps_provider_keys(self):
        with mock.patch.dict(
            os.environ, {"OPENAI_API_KEY": "direct-openai-key"}, clear=False
        ):
            environment = server.pdd_environment("local", 0.10)

        self.assertEqual(environment["PDD_CLOUD_RUN"], "false")
        self.assertEqual(environment["PDD_FORCE_LOCAL"], "1")
        self.assertEqual(environment["OPENAI_API_KEY"], "direct-openai-key")

    def test_cloud_command_does_not_force_local_mode(self):
        command = server.pdd_command(
            mode="cloud",
            costs=pathlib.Path("costs.csv"),
            language="TypeScript",
            output="example.pdd.test.ts",
            prompt=pathlib.Path("example.prompt"),
            target=pathlib.Path("src/example.ts"),
        )

        self.assertNotIn("--local", command)
        self.assertEqual(command[-2:], ["example.prompt", "src/example.ts"])

    def test_local_command_includes_local_flag(self):
        command = server.pdd_command(
            mode="local",
            costs=pathlib.Path("costs.csv"),
            language="Python",
            output="tests/test_example_pdd.py",
            prompt=pathlib.Path("example.prompt"),
            target=pathlib.Path("example.py"),
        )

        self.assertIn("--local", command)


if __name__ == "__main__":
    unittest.main()
