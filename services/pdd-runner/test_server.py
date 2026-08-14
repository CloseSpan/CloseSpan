import hashlib
import hmac
import io
import json
import os
import pathlib
import subprocess
import tempfile
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


def profile_config_v3():
    return {
        **profile_config(),
        "schemaVersion": 3,
        "tenkiImage": None,
        "tenkiSnapshotId": None,
        "automaticInstall": True,
        "automaticBuild": True,
        "publicEnvironment": [],
        "secretBindings": [],
        "startCommand": None,
        "applicationPort": None,
        "healthCheckPath": None,
        "healthCheckTimeoutMs": 90000,
        "previewEnabled": False,
        "previewTtlMs": 120000,
        "runtimeTools": {"http": False, "browser": False, "logs": False},
        "executor": {
            "kind": "tenki_github_actions",
            "platform": "macos",
            "architecture": "arm64",
            "runnerLabel": "tenki-macos-15-small",
            "workflowPath": ".github/workflows/closespan-agent-runner.yml",
            "workflowSha256": "d" * 64,
            "xcode": {
                "version": "16",
                "containerKind": "project",
                "containerPath": "apps/web/App.xcodeproj",
                "scheme": "App",
                "configuration": "Debug",
                "destination": "platform=iOS Simulator,name=iPhone 16",
                "sdk": "iphonesimulator",
                "signingPolicy": "simulator_only",
            },
            "androidEmulator": None,
        },
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


def prompt_evaluation():
    return {
        "schemaVersion": 1,
        "requestId": "66666666-6666-4666-8666-666666666666",
        "promptHash": "c" * 64,
        "userStory": "As an analyst, I want a complete export, so that reporting succeeds.",
        "implementationPrompt": "Make large exports complete and verifiable.",
        "pddVersion": "0.0.309",
        "evaluationMode": "pdd_cloud_with_local_fallback",
        "budgetUsd": 0.25,
    }


def local_runtime():
    return {
        "provider": "openai",
        "model": "gpt-5.6-sol",
        "apiKey": "workspace-openai-secret",
    }


def runner_local_runtime():
    return {
        "provider": "openai",
        "model": "gpt-5.6-sol",
        "credentialSource": "runner",
    }


class PddJobV2ValidationTest(unittest.TestCase):
    def setUp(self):
        self.version = mock.patch.object(server, "PDD_CLI_VERSION", "0.0.309")
        self.version.start()

    def tearDown(self):
        self.version.stop()

    def test_accepts_signed_job_with_execution_profile_schema_v1(self):
        self.assertEqual(server.validate_job(job())["schemaVersion"], 2)

    def test_accepts_signed_job_with_execution_profile_schema_v3(self):
        self.assertEqual(
            server.validate_job(job(profile_config_v3()))["schemaVersion"], 2,
        )

    def test_accepts_bounded_prompt_evaluation(self):
        value = server.validate_prompt_evaluation({
            "schemaVersion": 1,
            "requestId": "66666666-6666-4666-8666-666666666666",
            "promptHash": "c" * 64,
            "userStory": "As an analyst, I want a complete export, so that reporting succeeds.",
            "implementationPrompt": "Make large exports complete and verifiable.",
            "pddVersion": "0.0.309",
            "evaluationMode": "pdd_local",
            "localRuntime": local_runtime(),
            "budgetUsd": 0.25,
        })
        self.assertEqual(value["budgetUsd"], 0.25)
        self.assertEqual(value["evaluationMode"], "pdd_local")
        self.assertEqual(value["localRuntime"]["provider"], "openai")

    def test_accepts_a_runner_credential_reference_without_a_transmitted_key(self):
        value = prompt_evaluation()
        value["evaluationMode"] = "pdd_local"
        value["localRuntime"] = runner_local_runtime()

        validated = server.validate_prompt_evaluation(value)

        self.assertEqual(validated["localRuntime"]["credentialSource"], "runner")
        self.assertNotIn("apiKey", validated["localRuntime"])

    def test_accepts_an_immutable_complete_contract_for_a_retest(self):
        value = prompt_evaluation()
        value["acceptanceContract"] = "\n\n".join(
            f"## {heading}\nBound {heading}."
            for heading in server.PROMPT_CONTRACT_CHANGE_SECTIONS
        )

        validated = server.validate_prompt_evaluation(value)

        self.assertIn("## Acceptance Criteria", validated["acceptanceContract"])

    def test_rejects_an_incomplete_retest_contract(self):
        value = prompt_evaluation()
        value["acceptanceContract"] = "## Context\nOnly one section."

        with self.assertRaisesRegex(ValueError, "contract is incomplete"):
            server.validate_prompt_evaluation(value)

    def test_rejects_local_prompt_evaluation_without_workspace_runtime(self):
        value = prompt_evaluation()
        value["evaluationMode"] = "pdd_local"
        with self.assertRaisesRegex(ValueError, "local runtime is required"):
            server.validate_prompt_evaluation(value)

    def test_rejects_workspace_runtime_for_pdd_cloud(self):
        value = prompt_evaluation()
        value["evaluationMode"] = "pdd_cloud"
        value["localRuntime"] = local_runtime()
        with self.assertRaisesRegex(ValueError, "cannot receive local credentials"):
            server.validate_prompt_evaluation(value)

    def test_rejects_unknown_prompt_evaluation_mode(self):
        value = prompt_evaluation()
        value["evaluationMode"] = "direct_openai"
        with self.assertRaisesRegex(ValueError, "mode is invalid"):
            server.validate_prompt_evaluation(value)

    def test_parses_actionable_story_detection(self):
        verdict, changes = server.parse_story_detection(json.dumps({
            "schema_version": "pdd.detect.stories.v1",
            "outcome": "STORY_FAILURE",
            "results": [{
                "verdict": "FAIL",
                "changes": [{
                    "prompt_name": "suggested.prompt",
                    "change_instructions": "Require the downloaded CSV to contain every expected row.",
                }],
            }],
        }))
        self.assertEqual(verdict, "Needs revision")
        self.assertEqual(changes, ["Require the downloaded CSV to contain every expected row."])

    def test_preserves_every_numbered_story_change_without_clipping_the_last_item(self):
        fourth = "Verify the Oracle payload includes every submitted name and the expected workflow metadata."
        detail = " Keep the instruction explicit, testable, repository-bound, and safe for an immutable prompt revision."
        packed = " ".join([
            "1. Update the opening sentence to name the affected input." + detail,
            "2. Update the first acceptance criterion to verify submitted names." + detail,
            "3. Retain the no-Post-Context regression criterion." + detail,
            f"4. {fourth}",
        ])
        self.assertGreater(len(packed), 500)
        verdict, changes = server.parse_story_detection(json.dumps({
            "schema_version": "pdd.detect.stories.v1",
            "outcome": "STORY_FAILURE",
            "results": [{
                "verdict": "FAIL",
                "changes": [{"change_instructions": packed}],
            }],
        }))
        self.assertEqual(verdict, "Needs revision")
        self.assertEqual(len(changes), 4)
        self.assertEqual(changes[3], fourth)

    def test_recovers_complete_contract_sections_when_detector_text_is_cut_off(self):
        contract = """# Requested outcome

## Context
The affected workflow accepts a Post Context value containing names.

## Acceptance Criteria
1. Given valid names, when the workflow is submitted, then every name is present in the payload.

## Oracle
- The submitted payload contains every entered name.

## Non-Oracle
- Internal component structure does not determine the result.

## Negative Cases
- The workflow must not silently omit a valid name.

## Non-Goals
- Redesigning unrelated inputs is out of scope.
"""
        changes = server.complete_story_changes([
            "Retain the existing safety constraints.",
            'Insert the generated contract sections, including "Negative Cases" (the bullet',
        ], contract)

        self.assertEqual(len(changes), 6)
        self.assertIn("## Acceptance Criteria", changes[1])
        self.assertIn("every name is present in the payload", changes[1])
        self.assertIn("must not silently omit a valid name", changes[4])
        self.assertTrue(all(server.prompt_change_is_complete(change) for change in changes))

    def test_surfaces_story_detection_infrastructure_failure(self):
        with self.assertRaisesRegex(RuntimeError, "provider:UNAVAILABLE"):
            server.parse_story_detection(json.dumps({
                "schema_version": "pdd.detect.stories.v1",
                "outcome": "INFRASTRUCTURE_ERROR",
                "results": [],
                "stop_reason": "provider:UNAVAILABLE",
            }))

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


class SwiftPddTargetTest(unittest.TestCase):
    def test_places_a_standalone_swift_acceptance_script_at_the_xcode_root(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = pathlib.Path(temporary)
            project = root / "ZupNative" / "Zup.xcodeproj"
            target = root / "ZupNative" / "Zup" / "AppModel.swift"
            project.mkdir(parents=True)
            target.parent.mkdir(parents=True)
            target.write_text("struct AppModel {}", encoding="utf-8")

            selected, language, output = server.choose_target(
                root, ["ZupNative/Zup/AppModel.swift"]
            )

            self.assertEqual(selected, target)
            self.assertEqual(language, "Swift")
            self.assertEqual(
                output, pathlib.Path("ZupNative/tests/CloseSpanPDDTests.swift")
            )

    def test_skips_a_suspected_file_when_its_test_output_is_not_permitted(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = pathlib.Path(temporary)
            web = root / "app" / "privacy" / "page.tsx"
            project = root / "ZupNative" / "Zup.xcodeproj"
            swift = root / "ZupNative" / "Zup" / "AppModel.swift"
            web.parent.mkdir(parents=True)
            web.write_text("export default function Page() {}", encoding="utf-8")
            project.mkdir(parents=True)
            swift.parent.mkdir(parents=True)
            swift.write_text("struct AppModel {}", encoding="utf-8")

            selected, language, output = server.choose_target(
                root,
                ["app/privacy/page.tsx", "ZupNative/Zup/AppModel.swift"],
                ["ZupNative/tests/**"],
            )

            self.assertEqual(selected, swift)
            self.assertEqual(language, "Swift")
            self.assertEqual(
                output, pathlib.Path("ZupNative/tests/CloseSpanPDDTests.swift")
            )


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
                "executionProfileSchemaVersions": [1, 2, 3],
                "activeJobs": 0,
                "queuedJobs": 0,
                "runConcurrency": server.RUN_CONCURRENCY,
                "maxQueuedJobs": server.MAX_QUEUED_JOBS,
            })


class PddHandlerV2ValidationTest(unittest.TestCase):
    def setUp(self):
        server.ACTIVE_JOBS = 0
        server.QUEUED_JOBS = 0
        server.PROMPT_EVALUATIONS.clear()
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
        server.PROMPT_EVALUATIONS.clear()
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
        self.assertEqual(payload["executionProfileSchemaVersions"], [1, 2, 3])

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
        status, body = self.post(payload)
        self.assertEqual(status, 400)
        self.assertEqual(
            json.loads(body)["error"],
            "PDD execution profile secretBindings must contain metadata only",
        )
        self.execute_mock.assert_not_called()

    def signed_post(self, path, payload, *, immediate=False):
        body = json.dumps(payload, separators=(",", ":")).encode()
        signature = hmac.new(self.secret, body, hashlib.sha256).hexdigest()
        handler = self.handler(
            path=path,
            body=body,
            headers={
                "content-type": "application/json",
                "content-length": str(len(body)),
                "x-closespan-signature": signature,
            },
        )

        class ControlledThread:
            def __init__(self, *, target, args, daemon):
                self.target = target
                self.args = args

            def start(self):
                if immediate:
                    self.target(*self.args)

        with mock.patch.object(server.threading, "Thread", ControlledThread):
            handler.do_POST()
        if handler.send_error.called:
            return handler.send_error.call_args.args[0], handler.wfile.getvalue()
        return handler.send_response.call_args.args[0], handler.wfile.getvalue()

    def test_prompt_evaluation_is_accepted_without_waiting_for_pdd(self):
        payload = prompt_evaluation()
        status, body = self.signed_post("/prompt-evaluations", payload)
        self.assertEqual(status, 202)
        self.assertEqual(json.loads(body), {
            "schemaVersion": 1,
            "accepted": True,
            "requestId": payload["requestId"],
            "promptHash": payload["promptHash"],
            "status": "Queued",
        })
        self.assertEqual(
            server.prompt_evaluation_status(
                payload["requestId"], payload["promptHash"],
            )["status"],
            "Queued",
        )

    def test_prompt_evaluation_status_returns_pending_and_complete(self):
        payload = prompt_evaluation()
        self.assertTrue(server.register_prompt_evaluation(payload))
        status_payload = {
            "schemaVersion": 1,
            "requestId": payload["requestId"],
            "promptHash": payload["promptHash"],
        }
        status, body = self.signed_post(
            "/prompt-evaluations/status", status_payload,
        )
        self.assertEqual(status, 202)
        self.assertEqual(json.loads(body)["status"], "Queued")

        result = {
            "schemaVersion": 1,
            "requestId": payload["requestId"],
            "promptHash": payload["promptHash"],
            "verdict": "Passed",
            "changes": [],
            "pddVersion": "0.0.309",
            "executionMode": "cloud",
            "model": None,
            "costUsd": 0.01,
        }
        server.update_prompt_evaluation(
            payload["requestId"], status="Complete", result=result,
        )
        status, body = self.signed_post(
            "/prompt-evaluations/status", status_payload,
        )
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body), result)

    def test_prompt_evaluation_status_fails_closed_on_hash_mismatch(self):
        payload = prompt_evaluation()
        self.assertTrue(server.register_prompt_evaluation(payload))
        status, _ = self.signed_post("/prompt-evaluations/status", {
            "schemaVersion": 1,
            "requestId": payload["requestId"],
            "promptHash": "f" * 64,
        })
        self.assertEqual(status, 404)

    def test_prompt_evaluation_status_returns_bounded_failure(self):
        payload = prompt_evaluation()
        self.assertTrue(server.register_prompt_evaluation(payload))
        server.update_prompt_evaluation(
            payload["requestId"], status="Failed", error="contract failed",
        )
        status, body = self.signed_post("/prompt-evaluations/status", {
            "schemaVersion": 1,
            "requestId": payload["requestId"],
            "promptHash": payload["promptHash"],
        })
        self.assertEqual(status, 502)
        self.assertEqual(json.loads(body), {"error": "contract failed"})


class PddExecutionModeTests(unittest.TestCase):
    def test_prompt_evaluation_honors_local_mode_without_cloud(self):
        payload = prompt_evaluation()
        payload["evaluationMode"] = "pdd_local"
        payload["localRuntime"] = local_runtime()
        payload["budgetUsd"] = 5
        completed = subprocess.CompletedProcess(
            ["pdd"], 0,
            json.dumps({
                "schema_version": "pdd.detect.stories.v1",
                "outcome": "PASS",
                "results": [],
            }), "",
        )
        with mock.patch.object(
            server, "run_prompt_evaluation_pipeline", return_value=completed,
        ) as run:
            result = server.evaluate_prompt_with_pdd(payload)

        self.assertEqual(result["executionMode"], "local")
        self.assertEqual(run.call_args.kwargs["mode"], "local")
        self.assertEqual(run.call_args.kwargs["budget_usd"], 5)
        self.assertEqual(run.call_args.kwargs["local_runtime"], local_runtime())

    def test_prompt_evaluation_falls_back_only_when_selected(self):
        payload = prompt_evaluation()
        payload["localRuntime"] = local_runtime()
        payload["budgetUsd"] = 5
        completed = subprocess.CompletedProcess(
            ["pdd"], 0,
            json.dumps({
                "schema_version": "pdd.detect.stories.v1",
                "outcome": "PASS",
                "results": [],
            }), "",
        )
        with mock.patch.object(
            server,
            "run_prompt_evaluation_pipeline",
            side_effect=[RuntimeError("cloud unavailable"), completed],
        ) as run:
            result = server.evaluate_prompt_with_pdd(payload)

        self.assertEqual(result["executionMode"], "local")
        self.assertEqual(
            [call.kwargs["mode"] for call in run.call_args_list],
            ["cloud", "local"],
        )
        self.assertEqual(
            [call.kwargs["budget_usd"] for call in run.call_args_list],
            [0.25, 5],
        )

        payload["evaluationMode"] = "pdd_cloud"
        with mock.patch.object(
            server,
            "run_prompt_evaluation_pipeline",
            side_effect=RuntimeError("cloud unavailable"),
        ) as run:
            with self.assertRaisesRegex(RuntimeError, "cloud unavailable"):
                server.evaluate_prompt_with_pdd(payload)
        run.assert_called_once()

    def test_cloud_environment_uses_pddc_and_strips_direct_provider_keys(self):
        with (
            mock.patch.object(server, "PDD_REFRESH_TOKEN", "durable-refresh-token"),
            mock.patch.object(server, "PDD_JWT_TOKEN", "signed-token"),
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

    def test_cloud_environment_uses_keyring_refresh_when_no_jwt_is_injected(self):
        with (
            mock.patch.object(server, "PDD_REFRESH_TOKEN", "durable-refresh-token"),
            mock.patch.object(server, "PDD_JWT_TOKEN", ""),
            mock.patch.dict(
                os.environ,
                {
                    "PDD_JWT_TOKEN": "stale-token",
                    "PDD_REFRESH_TOKEN": "durable-refresh-token",
                },
                clear=False,
            ),
        ):
            environment = server.pdd_environment("cloud", 0.25)

        self.assertNotIn("PDD_REFRESH_TOKEN", environment)
        self.assertNotIn("PDD_JWT_TOKEN", environment)

    def test_local_environment_is_explicit_and_keeps_provider_keys(self):
        with mock.patch.dict(
            os.environ, {"OPENAI_API_KEY": "direct-openai-key"}, clear=False
        ):
            environment = server.pdd_environment("local", 0.10)

        self.assertEqual(environment["PDD_CLOUD_RUN"], "false")
        self.assertEqual(environment["PDD_FORCE_LOCAL"], "1")
        self.assertEqual(environment["OPENAI_API_KEY"], "direct-openai-key")

    def test_workspace_local_environment_isolates_one_provider_credential(self):
        with mock.patch.dict(
            os.environ,
            {
                "OPENAI_API_KEY": "runner-openai-key",
                "ANTHROPIC_API_KEY": "runner-anthropic-key",
                "PDD_MODEL_DEFAULT": "anthropic/runner-model",
            },
            clear=False,
        ):
            environment = server.pdd_environment(
                "local",
                0.10,
                local_runtime=local_runtime(),
                isolate_local_credentials=True,
            )

        self.assertEqual(environment["OPENAI_API_KEY"], "workspace-openai-secret")
        self.assertEqual(environment["PDD_MODEL_DEFAULT"], "openai/gpt-5.6")
        self.assertNotIn("ANTHROPIC_API_KEY", environment)

    def test_workspace_local_environment_can_reference_the_runner_credential(self):
        with mock.patch.dict(
            os.environ,
            {
                "OPENAI_API_KEY": "runner-openai-key",
                "ANTHROPIC_API_KEY": "runner-anthropic-key",
            },
            clear=False,
        ):
            environment = server.pdd_environment(
                "local",
                5,
                local_runtime=runner_local_runtime(),
                isolate_local_credentials=True,
                output_token_cap=server.PROMPT_EVALUATION_MAX_OUTPUT_TOKENS,
            )

        self.assertEqual(environment["OPENAI_API_KEY"], "runner-openai-key")
        self.assertEqual(environment["PDD_MODEL_DEFAULT"], "openai/gpt-5.6")
        self.assertNotIn("ANTHROPIC_API_KEY", environment)

    def test_prompt_review_environment_caps_reserved_model_output(self):
        environment = server.pdd_environment(
            "local",
            5,
            local_runtime=local_runtime(),
            isolate_local_credentials=True,
            output_token_cap=server.PROMPT_EVALUATION_MAX_OUTPUT_TOKENS,
        )

        self.assertEqual(environment["PDD_COMMAND_MAX_COST_USD"], "5.000000")
        self.assertEqual(environment["PDD_COMMAND_MAX_OUTPUT_TOKENS"], "4096")

    def test_unrelated_pdd_commands_do_not_inherit_an_output_token_cap(self):
        with mock.patch.dict(
            os.environ,
            {"PDD_COMMAND_MAX_OUTPUT_TOKENS": "999999"},
            clear=False,
        ):
            environment = server.pdd_environment("local", 0.10)

        self.assertNotIn("PDD_COMMAND_MAX_OUTPUT_TOKENS", environment)

    def test_workspace_local_model_maps_codex_service_tier_to_pdd_api_family(self):
        self.assertEqual(
            server.local_pdd_model({
                "provider": "openai",
                "model": "openai/gpt-5.6-terra",
                "apiKey": "workspace-openai-secret",
            }),
            "openai/gpt-5.6",
        )

    def test_workspace_local_model_preserves_catalog_model_names(self):
        self.assertEqual(
            server.local_pdd_model({
                "provider": "openai",
                "model": "gpt-5.3-codex",
                "apiKey": "workspace-openai-secret",
            }),
            "openai/gpt-5.3-codex",
        )

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

    def test_prompt_review_uses_pdd_contract_generation_before_detection(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = pathlib.Path(temporary)
            (root / "prompts").mkdir()
            (root / "user_stories").mkdir()
            (root / "requested-outcome.md").write_text(
                "# Requested outcome\n\nAs a user, I want complete exports.\n",
                encoding="utf-8",
            )
            (root / "prompts" / "suggested.prompt").write_text(
                "Correct large exports.", encoding="utf-8",
            )
            costs = root / "costs.csv"
            calls = []

            def fake_run(command, **kwargs):
                calls.append((command, kwargs))
                if command[-3:] == ["auth", "status", "--verify"]:
                    return subprocess.CompletedProcess(command, 0, "Authenticated", "")
                if "story" in command:
                    story = root / "user_stories" / "story__complete_large_exports.md"
                    contract = root / "user_stories" / "contracts" / "complete_large_exports.contract.md"
                    contract.parent.mkdir(parents=True)
                    story.write_text("# User Story: Requested outcome\n", encoding="utf-8")
                    contract.write_text("# Contract: Requested outcome\n", encoding="utf-8")
                    costs.write_text(
                        "cost,resolved_model\n0.0625,pdd-cloud\n",
                        encoding="utf-8",
                    )
                    return subprocess.CompletedProcess(command, 0, "generated", "")
                return subprocess.CompletedProcess(
                    command,
                    1,
                    json.dumps({
                        "schema_version": "pdd.detect.stories.v1",
                        "outcome": "STORY_FAILURE",
                        "results": [{
                            "verdict": "FAIL",
                            "changes": [{
                                "change_instructions": "Require every exported row.",
                            }],
                        }],
                    }),
                    "",
                )

            with mock.patch.object(server.subprocess, "run", side_effect=fake_run):
                detection = server.run_prompt_evaluation_pipeline(
                    root=root, mode="cloud", budget_usd=0.25, costs=costs,
                )

        self.assertEqual(len(calls), 3)
        self.assertEqual(calls[0][0], ["pdd", "auth", "status", "--verify"])
        self.assertEqual(calls[1][0][calls[1][0].index("story"):][:2], ["story", "add"])
        self.assertIn("detect", calls[2][0])
        self.assertEqual(json.loads(detection.stdout)["outcome"], "STORY_FAILURE")
        self.assertEqual(calls[1][1]["env"]["PDD_COMMAND_MAX_COST_USD"], "0.062500")
        self.assertEqual(calls[2][1]["env"]["PDD_COMMAND_MAX_COST_USD"], "0.187500")

    def test_prompt_retest_reuses_saved_contract_without_regenerating_it(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = pathlib.Path(temporary)
            (root / "prompts").mkdir()
            (root / "user_stories").mkdir()
            (root / "requested-outcome.md").write_text(
                "# Requested outcome\n\nAs a user, I want to undo a replacement.\n",
                encoding="utf-8",
            )
            (root / "prompts" / "suggested.prompt").write_text(
                "Preserve the prior value and expose Undo.\n", encoding="utf-8",
            )
            contract = """## Covers
- Undo replacement

## Context
An existing value is present.

## Acceptance Criteria
- Undo restores the value.

## Oracle
The prior value is visible.

## Non-Oracle
Internal state alone is insufficient.

## Negative Cases
- No prior value.

## Non-Goals
- Multi-level history.

## Candidate Prompts
- suggested.prompt

## Notes
Retest the saved boundary.
"""
            calls = []

            def fake_run(command, **kwargs):
                calls.append((command, kwargs))
                if command[-3:] == ["auth", "status", "--verify"]:
                    return subprocess.CompletedProcess(command, 0, "Authenticated", "")
                return subprocess.CompletedProcess(
                    command,
                    0,
                    json.dumps({
                        "schema_version": "pdd.detect.stories.v1",
                        "outcome": "PASS",
                        "results": [{"verdict": "PASS", "changes": []}],
                    }),
                    "",
                )

            with mock.patch.object(server.subprocess, "run", side_effect=fake_run):
                detection = server.run_prompt_evaluation_pipeline(
                    root=root,
                    mode="cloud",
                    budget_usd=0.25,
                    costs=root / "costs.csv",
                    acceptance_contract=contract,
                )

            story, saved_contract = server.prompt_evaluation_artifacts(root)
            story_text = story.read_text()
            saved_contract_text = saved_contract.read_text()

        self.assertEqual(len(calls), 2)
        self.assertTrue(all("story" not in call[0] for call in calls))
        self.assertEqual(calls[0][0], ["pdd", "auth", "status", "--verify"])
        self.assertIn("detect", calls[1][0])
        self.assertEqual(json.loads(detection.stdout)["outcome"], "PASS")
        self.assertIn("As a user, I want to undo a replacement.", story_text)
        self.assertEqual(saved_contract_text, contract.strip() + "\n")

    def test_prompt_review_rejects_unpaired_contract_artifacts(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = pathlib.Path(temporary)
            stories = root / "user_stories"
            contracts = stories / "contracts"
            contracts.mkdir(parents=True)
            (stories / "story__expected.md").write_text("# Story\n", encoding="utf-8")
            (contracts / "different.contract.md").write_text("# Contract\n", encoding="utf-8")

            with self.assertRaisesRegex(RuntimeError, "inconsistent"):
                server.prompt_evaluation_artifacts(root)

    def test_prompt_review_maps_expired_cloud_authentication(self):
        process = subprocess.CompletedProcess(
            ["pdd"], 1, "Authentication expired", "Token expired",
        )

        error = server.pdd_prompt_stage_error("contract-generation", process)

        self.assertEqual(str(error), "PDD Cloud authentication could not be refreshed")

    def test_prompt_review_does_not_misclassify_generic_cost_text_as_budget(self):
        process = subprocess.CompletedProcess(
            ["pdd"], 1, "Cost tracking enabled", "Contract generation failed",
        )

        error = server.pdd_prompt_stage_error("contract-generation", process)

        self.assertEqual(str(error), "PDD could not complete the contract-generation stage")

    def test_prompt_review_maps_unsupported_local_model(self):
        process = subprocess.CompletedProcess(
            ["pdd"], 1, "", (
                "Provider-qualified base model 'openai/example' has no matching row "
                "under provider 'OpenAI'. Choose an available model."
            ),
        )

        error = server.pdd_prompt_stage_error(
            "contract-generation", process, mode="local",
        )

        self.assertEqual(
            str(error),
            "The configured AI model is not supported by Prompt Driven; choose a compatible model in AI Settings",
        )

    def test_prompt_review_maps_local_preflight_budget_exhaustion(self):
        process = subprocess.CompletedProcess(
            ["pdd"], 3, "", (
                "Required environment value for model 'claude-fable-5' is not set. "
                "All candidate models failed. Last error: Hosted command budget "
                "exhausted before provider invocation"
            ),
        )

        error = server.pdd_prompt_stage_error(
            "prompt-detection", process, mode="local",
        )

        self.assertEqual(
            str(error),
            "Local Prompt Driven evaluation could not complete within its bounded review budget",
        )

    def test_prompt_review_reserves_the_local_ceiling_for_detection(self):
        self.assertEqual(
            server.prompt_evaluation_stage_budgets(5),
            (0.25, 0.25, 4.5),
        )
        self.assertEqual(
            server.prompt_evaluation_stage_budgets(0.25),
            (0.0625, 0.0375, 0.15),
        )

    def test_prompt_review_returns_unused_repair_budget_to_detection(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = pathlib.Path(temporary)
            (root / "user_stories" / "contracts").mkdir(parents=True)
            (root / "prompts").mkdir()
            (root / "requested-outcome.md").write_text(
                "# Outcome\n", encoding="utf-8",
            )
            (root / "prompts" / "suggested.prompt").write_text(
                "Correct the workflow.\n", encoding="utf-8",
            )
            (root / "user_stories" / "story__outcome.md").write_text(
                "# User Story: Outcome\n", encoding="utf-8",
            )
            (root / "user_stories" / "contracts" / "outcome.contract.md").write_text(
                "# Contract: Outcome\n", encoding="utf-8",
            )
            costs = root / "costs.csv"
            calls = []

            def fake_run(command, **kwargs):
                calls.append((command, kwargs))
                if "story" in command:
                    costs.write_text(
                        "cost,resolved_model\n0.125,openai/gpt-5.6\n",
                        encoding="utf-8",
                    )
                    return subprocess.CompletedProcess(command, 0, "generated", "")
                return subprocess.CompletedProcess(
                    command,
                    0,
                    json.dumps({
                        "schema_version": "pdd.detect.stories.v1",
                        "outcome": "STORY_PASS",
                        "results": [{"verdict": "PASS", "changes": []}],
                    }),
                    "",
                )

            with mock.patch.object(server.subprocess, "run", side_effect=fake_run):
                server.run_prompt_evaluation_pipeline(
                    root=root,
                    mode="local",
                    budget_usd=5,
                    costs=costs,
                    local_runtime={
                        "provider": "openai",
                        "model": "gpt-5.6-sol",
                        "apiKey": "workspace-openai-secret",
                    },
                )

            detection_call = calls[-1]
            self.assertIn("detect", detection_call[0])
            self.assertEqual(
                detection_call[1]["env"]["PDD_COMMAND_MAX_COST_USD"],
                "4.875000",
            )
            self.assertEqual(
                detection_call[1]["env"]["PDD_COMMAND_MAX_OUTPUT_TOKENS"],
                "8192",
            )

    def test_cloud_authentication_is_verified_before_an_unattended_run(self):
        with mock.patch.object(
            server.subprocess,
            "run",
            return_value=subprocess.CompletedProcess(["pdd"], 0, "Authenticated", ""),
        ) as run:
            server.verify_pdd_cloud_authentication(mode="cloud", budget_usd=0.25)

        self.assertEqual(run.call_args.args[0], ["pdd", "auth", "status", "--verify"])
        self.assertNotIn("PDD_JWT_TOKEN", run.call_args.kwargs["env"])

    def test_cloud_authentication_failure_stops_before_evaluation(self):
        with mock.patch.object(
            server.subprocess,
            "run",
            return_value=subprocess.CompletedProcess(
                ["pdd"], 1, "Authentication expired", "Token expired",
            ),
        ):
            with self.assertRaisesRegex(RuntimeError, "authentication could not be refreshed"):
                server.verify_pdd_cloud_authentication(mode="cloud", budget_usd=0.25)

    def test_prompt_review_fails_closed_when_pdd_omits_contract(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = pathlib.Path(temporary)
            (root / "user_stories").mkdir()
            (root / "requested-outcome.md").write_text("# Outcome\n", encoding="utf-8")
            (root / "prompts").mkdir()
            (root / "prompts" / "suggested.prompt").write_text(
                "Correct the workflow.\n", encoding="utf-8",
            )

            def fake_run(command, **_kwargs):
                if command[-3:] == ["auth", "status", "--verify"]:
                    return subprocess.CompletedProcess(command, 0, "Authenticated", "")
                if "story" in command:
                    (root / "user_stories" / "story__outcome.md").write_text(
                        "# User Story: Outcome\n", encoding="utf-8",
                    )
                    return subprocess.CompletedProcess(command, 0, "generated", "")
                return subprocess.CompletedProcess(
                    command, 1, "Contract regeneration failed", "",
                )

            with mock.patch.object(
                server.subprocess,
                "run",
                side_effect=fake_run,
            ):
                with self.assertRaisesRegex(RuntimeError, "contract-regeneration"):
                    server.run_prompt_evaluation_pipeline(
                        root=root,
                        mode="cloud",
                        budget_usd=0.25,
                        costs=root / "costs.csv",
                    )

    def test_prompt_review_repairs_a_contract_skipped_by_story_add(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = pathlib.Path(temporary)
            (root / "user_stories").mkdir()
            (root / "prompts").mkdir()
            (root / "requested-outcome.md").write_text("# Outcome\n", encoding="utf-8")
            (root / "prompts" / "suggested.prompt").write_text(
                "Correct the workflow.\n", encoding="utf-8",
            )
            costs = root / "costs.csv"
            calls = []

            def fake_run(command, **kwargs):
                calls.append((command, kwargs))
                if command[-3:] == ["auth", "status", "--verify"]:
                    return subprocess.CompletedProcess(command, 0, "Authenticated", "")
                if "story" in command:
                    (root / "user_stories" / "story__outcome.md").write_text(
                        "# User Story: Outcome\n", encoding="utf-8",
                    )
                    return subprocess.CompletedProcess(command, 0, "generated without contract", "")
                if command[0:2] == ["python", "-c"]:
                    contract = root / "user_stories" / "contracts" / "outcome.contract.md"
                    contract.parent.mkdir(parents=True)
                    contract.write_text("# Contract: Outcome\n", encoding="utf-8")
                    return subprocess.CompletedProcess(
                        command,
                        0,
                        "Prompt Driven progress: CLOSESPAN_CONTRACT_REPAIR=" + json.dumps({
                            "changed": True,
                            "message": "Regenerated contract",
                            "cost": 0.012,
                            "model": "openai/gpt-5.6",
                            "contractPath": str(contract),
                        }) + "\x1b[0m",
                        "",
                    )
                return subprocess.CompletedProcess(
                    command,
                    0,
                    json.dumps({
                        "schema_version": "pdd.detect.stories.v1",
                        "outcome": "STORY_PASS",
                        "results": [{"verdict": "PASS", "changes": []}],
                    }),
                    "",
                )

            with mock.patch.object(server.subprocess, "run", side_effect=fake_run):
                detection = server.run_prompt_evaluation_pipeline(
                    root=root, mode="cloud", budget_usd=0.25, costs=costs,
                )

            self.assertEqual(len(calls), 4)
            self.assertEqual(calls[2][0][0:2], ["python", "-c"])
            self.assertEqual(
                calls[2][1]["env"]["PDD_COMMAND_MAX_COST_USD"], "0.037500",
            )
            self.assertEqual(json.loads(detection.stdout)["outcome"], "STORY_PASS")
            self.assertEqual(server.cost_report(costs), (0.012, "openai/gpt-5.6"))

    def test_contract_repair_command_contains_valid_python(self):
        command = server.pdd_contract_repair_command(
            story=pathlib.Path("user_stories/story__outcome.md"),
            issue=pathlib.Path("requested-outcome.md"),
            prompts=pathlib.Path("prompts"),
        )

        self.assertEqual(command[0:2], ["python", "-c"])
        compile(command[2], "<pdd-contract-repair>", "exec")

    def test_story_generation_command_uses_official_pdd_story_flow(self):
        command = server.pdd_story_command(
            mode="cloud",
            costs=pathlib.Path("costs.csv"),
            issue=pathlib.Path("requested-outcome.md"),
        )

        self.assertNotIn("--local", command)
        self.assertEqual(command[command.index("story"):command.index("story") + 2], ["story", "add"])
        self.assertIn("requested-outcome.md", command)
        self.assertIn("prompts/suggested.prompt", command)


if __name__ == "__main__":
    unittest.main()
