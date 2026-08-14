"""Small signed adapter around PDD Cloud with a controlled local fallback.

The service may reach the configured model provider and short-lived GitHub archive
URLs. It never receives GitHub credentials and never executes repository code.
"""

from __future__ import annotations

import csv
import fnmatch
import hashlib
import hmac
import io
import json
import os
import pathlib
import re
import subprocess
import tarfile
import tempfile
import threading
import time
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


MAX_JOB_BYTES = 1_000_000
MAX_ARCHIVE_BYTES = 50_000_000
MAX_OUTPUT_BYTES = 750_000
RUN_TIMEOUT_SECONDS = 240
PDD_VERSION_TIMEOUT_SECONDS = 60
RUN_CONCURRENCY = int(os.getenv("PDD_RUNNER_CONCURRENCY", "2"))
MAX_QUEUED_JOBS = int(os.getenv("PDD_RUNNER_MAX_QUEUED_JOBS", str(RUN_CONCURRENCY * 4)))
if RUN_CONCURRENCY <= 0 or MAX_QUEUED_JOBS < 0:
    raise ValueError("PDD runner concurrency and queue limits must be non-negative")
RUN_SLOTS = threading.BoundedSemaphore(RUN_CONCURRENCY)
JOB_STATE_LOCK = threading.Lock()
ACTIVE_JOBS = 0
QUEUED_JOBS = 0
SHARED_SECRET = os.environ.get("PDD_RUNNER_SHARED_SECRET", "").encode()
PDD_MODEL = os.environ.get("PDD_MODEL", "").strip()
PDD_EXECUTION_MODE = os.environ.get("PDD_EXECUTION_MODE", "local").strip().lower()
if PDD_EXECUTION_MODE not in {"cloud", "local"}:
    raise ValueError("PDD_EXECUTION_MODE must be cloud or local")
PDD_CLOUD_FALLBACK_ENABLED = os.environ.get(
    "PDD_CLOUD_FALLBACK_ENABLED", "false"
).strip().lower() in {"1", "true", "yes", "on"}
PROMPT_EVALUATION_MODES = {
    "pdd_cloud",
    "pdd_local",
    "pdd_cloud_with_local_fallback",
}
PDD_JWT_TOKEN = os.environ.get("PDD_JWT_TOKEN", "").strip()
PDD_REFRESH_TOKEN = os.environ.get("PDD_REFRESH_TOKEN", "").strip()
CALLBACK_ORIGIN = os.environ.get("CLOSESPAN_CALLBACK_ORIGIN", "").strip().rstrip("/")
PDD_CLI_VERSION: str | None = None
PROMPT_EVALUATION_LOCK = threading.Lock()
PROMPT_EVALUATIONS: dict[str, dict] = {}
MAX_PROMPT_EVALUATIONS = 256
PROMPT_EVALUATION_RETENTION_SECONDS = 3_600
PDD_VERSION_TOKEN = re.compile(
    r"(?<![0-9A-Za-z.])v?(\d{1,4}\.\d{1,4}\.\d{1,4})(?![0-9A-Za-z.])"
)
MAX_PROMPT_CHANGE_CHARACTERS = 16_000
# PDD reserves a model's maximum output cost before each internal provider
# call. Keep prompt-review stages bounded so a high-output model cannot exhaust
# the request-wide dollar ceiling before later detector calls are invoked.
PROMPT_EVALUATION_MAX_OUTPUT_TOKENS = 4_096
PROMPT_EVALUATION_DETECTION_MAX_OUTPUT_TOKENS = 8_192
PROMPT_CONTRACT_CHANGE_SECTIONS = (
    "Context",
    "Acceptance Criteria",
    "Oracle",
    "Non-Oracle",
    "Negative Cases",
    "Non-Goals",
)

PROFILE_CONFIG_BASE_KEYS = {
    "language", "framework", "packageManager", "runtimeVersion",
    "workingDirectory", "installCommands", "buildCommands", "testCommands",
    "typecheckCommands", "permittedPaths", "tenkiImage", "tenkiSnapshotId",
    "cpuCores", "memoryMb", "allowInbound", "allowOutbound", "maxDurationMs",
    "idleTimeoutMinutes",
}
PROFILE_CONFIG_V1_KEYS = PROFILE_CONFIG_BASE_KEYS | {"schemaVersion"}
PROFILE_CONFIG_V2_KEYS = PROFILE_CONFIG_V1_KEYS | {
    "automaticInstall", "automaticBuild", "publicEnvironment", "secretBindings",
    "startCommand", "applicationPort", "healthCheckPath", "healthCheckTimeoutMs",
    "previewEnabled", "previewTtlMs", "runtimeTools",
}
PROFILE_CONFIG_V3_KEYS = PROFILE_CONFIG_V2_KEYS | {"executor"}
PROFILE_SNAPSHOT_KEYS = {
    "profileId", "version", "source", "repository", "workspaceRoot",
    "contentHash", "config",
}
PROFILE_SOURCES = {"confirmed", "override", "safe_generic"}
ENVIRONMENT_NAME = re.compile(r"^[A-Z_][A-Z0-9_]{0,127}$")
REPOSITORY_NAME = re.compile(r"^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$")
HEALTH_CHECK_PATH = re.compile(r"^/(?!/)[^\s?#]{0,499}$")
UUID_VALUE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
    re.IGNORECASE,
)
RESERVED_RUNTIME_ENVIRONMENT_NAMES = {
    "BASH_ENV", "CI", "ENV", "HOME", "IFS", "LD_LIBRARY_PATH", "LD_PRELOAD",
    "NODE_OPTIONS", "OLDPWD", "PATH", "PORT", "PWD", "SHELL",
}
CREDENTIAL_ENVIRONMENT_NAME = re.compile(
    r"(?:^|_)(?:API_KEY|PRIVATE_KEY|SECRET_ACCESS_KEY|ACCESS_KEY_ID|CLIENT_SECRET|AUTH_TOKEN|ACCESS_TOKEN|REFRESH_TOKEN|WEBHOOK_SECRET|SIGNING_SECRET|ENCRYPTION_KEY)(?:_|$)"
    r"|(?:^|_)(?:SECRET|TOKEN|PASSWORD|PASSWD|CREDENTIALS?|DSN|PAT)$"
    r"|^(?:DATABASE|REDIS|MONGODB|POSTGRES)_URL$"
)
CREDENTIAL_VALUE_PATTERNS = (
    re.compile(r"-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----"),
    re.compile(r"(?:github_pat_|gh[pousr]_|glpat-|xox[baprs]-)[A-Za-z0-9_-]{16,}"),
    re.compile(r"(?:^|[^A-Za-z0-9])AKIA[0-9A-Z]{16}(?:$|[^A-Za-z0-9])"),
    re.compile(r"(?:^|[^A-Za-z0-9])(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{10,}"),
    re.compile(r"(?:^|[^A-Za-z0-9])sk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}"),
    re.compile(r"^Bearer\s+\S+", re.IGNORECASE),
    re.compile(r"^[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}$"),
    re.compile(r"^[a-z][a-z0-9+.-]*://[^/\s:@]+:[^/\s@]+@", re.IGNORECASE),
    re.compile(r"(?:^|[?&;\s])(?:api[_-]?key|access[_-]?token|auth[_-]?token|password|secret)=[^\s&;]+", re.IGNORECASE),
)
LOCAL_PROVIDER_CREDENTIALS = {
    "ANTHROPIC_API_KEY", "AZURE_API_KEY", "AZURE_OPENAI_API_KEY",
    "GEMINI_API_KEY", "GOOGLE_API_KEY", "GROQ_API_KEY", "MISTRAL_API_KEY",
    "OPENAI_API_KEY", "OPENROUTER_API_KEY", "TOGETHERAI_API_KEY", "XAI_API_KEY",
}
WORKSPACE_LOCAL_PROVIDERS = {
    "openai": ("OPENAI_API_KEY", "openai"),
    "anthropic": ("ANTHROPIC_API_KEY", "anthropic"),
    "xai": ("XAI_API_KEY", "xai"),
    "openrouter": ("OPENROUTER_API_KEY", "openrouter"),
}
OPENAI_CODEX_SERVICE_TIERS = {"sol", "terra", "luna"}
PDD_MODEL_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$")
RUNTIME_TOOL_KEYS = {"http", "browser", "logs"}
BROWSER_PREFLIGHT_COMMAND = (
    'node -e "let c;try{c=require(\'playwright\').chromium}catch{c=require(\'@playwright/test\').chromium}'
    "(async()=>{const b=await c.launch({headless:true});const x=await b.newContext({serviceWorkers:'block'});"
    "if(typeof x.routeWebSocket!=='function')throw new Error('Playwright WebSocket routing is unavailable');"
    "await x.close();await b.close()})().catch(e=>{console.error(e instanceof Error?e.message:String(e));process.exit(1)})\""
)
PLAYWRIGHT_INSTALL_COMMANDS = {
    "npm": "npm exec -- playwright install chromium",
    "pnpm": "pnpm exec playwright install chromium",
    "yarn": "yarn exec playwright install chromium",
    "bun": "bunx playwright install chromium",
}


def digest(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def canonical_json(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def detect_pdd_cli_version() -> str:
    """Return the one bounded semantic-version token reported by the PDD binary."""
    try:
        process = subprocess.run(
            ["pdd", "--version"], capture_output=True, text=True,
            timeout=PDD_VERSION_TIMEOUT_SECONDS, check=False,
        )
    except (OSError, subprocess.TimeoutExpired) as error:
        raise RuntimeError("Could not execute pdd --version") from error
    if process.returncode != 0:
        raise RuntimeError("pdd --version exited unsuccessfully")
    output = "\n".join(part for part in (process.stdout, process.stderr) if part).strip()
    if not output or len(output) > 4_096:
        raise RuntimeError("pdd --version returned invalid output")
    versions = set(PDD_VERSION_TOKEN.findall(output))
    if len(versions) != 1:
        raise RuntimeError("pdd --version did not report exactly one semantic version")
    return versions.pop()


def health_payload() -> dict:
    cloud_configured = PDD_EXECUTION_MODE != "cloud" or bool(
        PDD_REFRESH_TOKEN or PDD_JWT_TOKEN
    )
    configured = bool(
        SHARED_SECRET and CALLBACK_ORIGIN and PDD_CLI_VERSION and cloud_configured
    )
    with JOB_STATE_LOCK:
        active_jobs = ACTIVE_JOBS
        queued_jobs = QUEUED_JOBS
    return {
        "status": "ok" if configured else "not_configured",
        "pddVersion": PDD_CLI_VERSION,
        "executionMode": PDD_EXECUTION_MODE,
        "localFallbackEnabled": PDD_CLOUD_FALLBACK_ENABLED,
        "executionProfileSchemaVersions": [1, 2, 3],
        "activeJobs": active_jobs,
        "queuedJobs": queued_jobs,
        "runConcurrency": RUN_CONCURRENCY,
        "maxQueuedJobs": MAX_QUEUED_JOBS,
    }


def reserve_job() -> bool:
    global QUEUED_JOBS
    with JOB_STATE_LOCK:
        if ACTIVE_JOBS + QUEUED_JOBS >= RUN_CONCURRENCY + MAX_QUEUED_JOBS:
            return False
        QUEUED_JOBS += 1
        return True


def cancel_reserved_job() -> None:
    global QUEUED_JOBS
    with JOB_STATE_LOCK:
        QUEUED_JOBS = max(0, QUEUED_JOBS - 1)


def begin_reserved_job() -> None:
    global ACTIVE_JOBS, QUEUED_JOBS
    with JOB_STATE_LOCK:
        QUEUED_JOBS = max(0, QUEUED_JOBS - 1)
        ACTIVE_JOBS += 1


def finish_job() -> None:
    global ACTIVE_JOBS
    with JOB_STATE_LOCK:
        ACTIVE_JOBS = max(0, ACTIVE_JOBS - 1)


def safe_relative_path(value: object, label: str) -> str:
    if not isinstance(value, str) or not value or len(value) > 500:
        raise ValueError(f"{label} must be a repository-relative path")
    normalized = value.strip().replace("\\", "/")
    if not normalized or normalized.startswith("/") or "\x00" in normalized:
        raise ValueError(f"{label} must be a repository-relative path")
    if len(normalized) >= 3 and normalized[0].isalpha() and normalized[1:3] == ":/":
        raise ValueError(f"{label} must be a repository-relative path")
    segments = [segment for segment in normalized.split("/") if segment]
    if ".." in segments:
        raise ValueError(f"{label} cannot traverse outside the repository")
    compact = "/".join(segment for index, segment in enumerate(segments) if not (index == 0 and segment == "."))
    return compact or "."


def string_list(value: object, label: str, limit: int) -> list[str]:
    if not isinstance(value, list) or len(value) > limit:
        raise ValueError(f"{label} is invalid")
    result: list[str] = []
    for item in value:
        if not isinstance(item, str) or not item.strip() or len(item) > 1_000:
            raise ValueError(f"{label} is invalid")
        normalized = item.replace("\r\n", "\n").replace("\r", "\n").strip()
        if any(ord(character) < 32 and character not in "\n\t" for character in normalized):
            raise ValueError(f"{label} contains a prohibited control character")
        result.append(normalized)
    return result


def path_pattern_is_narrower(ticket_pattern: str, allowed_pattern: str) -> bool:
    if ticket_pattern == allowed_pattern or allowed_pattern == "**/*":
        return True
    if "*" not in ticket_pattern and fnmatch.fnmatchcase(ticket_pattern, allowed_pattern):
        return True
    if allowed_pattern.endswith("/**"):
        allowed_prefix = allowed_pattern[:-3].rstrip("/")
        ticket_prefix = ticket_pattern.split("*", 1)[0].rstrip("/")
        return ticket_prefix == allowed_prefix or ticket_prefix.startswith(f"{allowed_prefix}/")
    return False


def validate_environment_name(value: object, *, secret: bool) -> str:
    if not isinstance(value, str) or not ENVIRONMENT_NAME.fullmatch(value):
        raise ValueError("PDD execution profile environment name is invalid")
    if (
        value in RESERVED_RUNTIME_ENVIRONMENT_NAMES
        or value.startswith("CLOSESPAN_")
        or value.startswith("TENKI_")
    ):
        raise ValueError(f"PDD execution profile environment name {value} is reserved")
    if not secret and CREDENTIAL_ENVIRONMENT_NAME.search(value):
        raise ValueError(f"PDD public environment variable {value} looks like a secret")
    return value


def valid_uuid(value: object) -> bool:
    return isinstance(value, str) and UUID_VALUE.fullmatch(value) is not None


def validate_public_environment(value: object) -> tuple[list[dict], set[str]]:
    if not isinstance(value, list) or len(value) > 100:
        raise ValueError("PDD execution profile publicEnvironment is invalid")
    result: list[dict] = []
    names: set[str] = set()
    for item in value:
        if not isinstance(item, dict) or set(item) != {"name", "value"}:
            raise ValueError("PDD execution profile publicEnvironment is invalid")
        name = validate_environment_name(item.get("name"), secret=False)
        public_value = item.get("value")
        if not isinstance(public_value, str) or len(public_value) > 4_000:
            raise ValueError(f"PDD public environment variable {name} is invalid")
        if any(
            ord(character) in {*range(0, 9), 11, 12, *range(14, 32), 127}
            for character in public_value
        ):
            raise ValueError(f"PDD public environment variable {name} contains a prohibited control character")
        if "\r" in public_value:
            raise ValueError(f"PDD public environment variable {name} is not normalized")
        if any(pattern.search(public_value) for pattern in CREDENTIAL_VALUE_PATTERNS):
            raise ValueError(f"PDD public environment variable {name} contains a secret-looking value")
        if name in names:
            raise ValueError(f"Duplicate public environment variable: {name}")
        names.add(name)
        result.append(item)
    if result != sorted(result, key=lambda item: item["name"]):
        raise ValueError("PDD execution profile publicEnvironment is not normalized")
    return result, names


def validate_secret_bindings(value: object, public_names: set[str]) -> list[dict]:
    if not isinstance(value, list) or len(value) > 100:
        raise ValueError("PDD execution profile secretBindings is invalid")
    result: list[dict] = []
    phase_names: set[str] = set()
    for item in value:
        if not isinstance(item, dict) or set(item) != {
            "envName", "secretId", "secretVersion", "exposure",
        }:
            raise ValueError("PDD execution profile secretBindings must contain metadata only")
        name = validate_environment_name(item.get("envName"), secret=True)
        secret_id = item.get("secretId")
        if not valid_uuid(secret_id):
            raise ValueError("PDD execution profile secret binding ID is invalid") from None
        version = item.get("secretVersion")
        if type(version) is not int or version <= 0:
            raise ValueError("PDD execution profile secret binding version is invalid")
        exposure = item.get("exposure")
        if exposure not in {"setup", "runtime", "test"}:
            raise ValueError("PDD execution profile secret binding exposure is invalid")
        if name in public_names:
            raise ValueError(f"PDD environment variable {name} cannot be both public and secret")
        phase_name = f"{exposure}:{name}"
        if phase_name in phase_names:
            raise ValueError(f"Duplicate {exposure} secret environment variable: {name}")
        phase_names.add(phase_name)
        result.append(item)
    expected = sorted(
        result,
        key=lambda item: (item["envName"], item["exposure"], item["secretVersion"]),
    )
    if result != expected:
        raise ValueError("PDD execution profile secretBindings is not normalized")
    return result


def validate_runtime_v2_config(config: dict, command_groups: dict[str, list[str]]) -> None:
    for field in ("automaticInstall", "automaticBuild", "previewEnabled"):
        if type(config.get(field)) is not bool:
            raise ValueError(f"PDD execution profile {field} is invalid")
    if config["automaticInstall"] and not command_groups["installCommands"]:
        raise ValueError("PDD automatic install requires at least one install command")
    if config["automaticBuild"] and not command_groups["buildCommands"]:
        raise ValueError("PDD automatic build requires at least one build command")

    _, public_names = validate_public_environment(config.get("publicEnvironment"))
    secret_bindings = validate_secret_bindings(config.get("secretBindings"), public_names)

    start_command = config.get("startCommand")
    if start_command is not None:
        normalized = string_list([start_command], "startCommand", 1)[0]
        if normalized != start_command:
            raise ValueError("PDD execution profile startCommand is not normalized")
    application_port = config.get("applicationPort")
    if application_port is not None and (
        type(application_port) is not int or not 1_024 <= application_port <= 65_535
    ):
        raise ValueError("PDD execution profile applicationPort is invalid")
    health_path = config.get("healthCheckPath")
    if health_path is not None and (
        not isinstance(health_path, str) or not HEALTH_CHECK_PATH.fullmatch(health_path)
    ):
        raise ValueError("PDD execution profile healthCheckPath is invalid")
    runtime_fields = (start_command, application_port, health_path)
    if any(value is not None for value in runtime_fields) and not all(
        value is not None for value in runtime_fields
    ):
        raise ValueError("PDD running application requires start command, port, and health check")
    for field, minimum, maximum in (
        ("healthCheckTimeoutMs", 5_000, 600_000),
        ("previewTtlMs", 60_000, 900_000),
    ):
        value = config.get(field)
        if type(value) is not int or value < minimum or value > maximum:
            raise ValueError(f"PDD execution profile {field} is invalid")

    runtime_tools = config.get("runtimeTools")
    if not isinstance(runtime_tools, dict) or set(runtime_tools) != RUNTIME_TOOL_KEYS:
        raise ValueError("PDD execution profile runtimeTools is invalid")
    if any(type(runtime_tools.get(tool)) is not bool for tool in RUNTIME_TOOL_KEYS):
        raise ValueError("PDD execution profile runtimeTools is invalid")
    if any(runtime_tools.values()) and start_command is None:
        raise ValueError("PDD runtime tools require a configured running application")

    if config["previewEnabled"] and not config["allowInbound"]:
        raise ValueError("PDD preview requires inbound networking")
    if config["previewEnabled"] and any(
        binding["exposure"] == "runtime" for binding in secret_bindings
    ):
        raise ValueError("PDD preview cannot be combined with runtime secrets")
    if config["allowOutbound"] and any(
        binding["exposure"] in {"runtime", "test"} for binding in secret_bindings
    ):
        raise ValueError("PDD outbound execution cannot use runtime or test secrets")

    if runtime_tools["browser"]:
        install_commands = set(command_groups["installCommands"])
        package_manager = config["packageManager"].strip().lower().split("@", 1)[0]
        playwright_install = PLAYWRIGHT_INSTALL_COMMANDS.get(package_manager)
        immutable_boot = bool(config.get("tenkiImage") or config.get("tenkiSnapshotId"))
        repository_provisioning = bool(playwright_install and playwright_install in install_commands)
        if not config["automaticInstall"]:
            raise ValueError("PDD browser tool requires automatic setup")
        if BROWSER_PREFLIGHT_COMMAND not in install_commands:
            raise ValueError("PDD browser tool requires the exact Chromium launch preflight")
        if immutable_boot and repository_provisioning:
            raise ValueError("PDD browser tool must use either image or repository provisioning")
        if not immutable_boot:
            if not repository_provisioning:
                raise ValueError("PDD browser tool requires the exact Chromium install command")
            if not config["allowOutbound"]:
                raise ValueError("PDD repository Chromium provisioning requires outbound access")


def validate_execution_profile(job: dict) -> dict:
    profile_id = job.get("executionProfileId")
    profile_hash = job.get("executionProfileHash")
    snapshot = job.get("executionProfileSnapshot")
    if not isinstance(profile_id, str) or not isinstance(profile_hash, str):
        raise ValueError("PDD job is missing its execution profile binding")
    if not valid_uuid(profile_id):
        raise ValueError("PDD execution profile ID is invalid") from None
    if len(profile_hash) != 64 or any(character not in "0123456789abcdef" for character in profile_hash):
        raise ValueError("PDD execution profile hash is invalid")
    if not isinstance(snapshot, dict) or set(snapshot) != PROFILE_SNAPSHOT_KEYS:
        raise ValueError("PDD execution profile snapshot is invalid")
    if snapshot.get("profileId") != profile_id or snapshot.get("contentHash") != profile_hash:
        raise ValueError("PDD execution profile binding does not match its snapshot")
    if type(snapshot.get("version")) is not int or snapshot["version"] <= 0:
        raise ValueError("PDD execution profile version is invalid")
    if snapshot.get("source") not in PROFILE_SOURCES:
        raise ValueError("An inactive detected profile cannot run PDD")

    repository = snapshot.get("repository")
    if not isinstance(repository, str) or (
        repository and not REPOSITORY_NAME.fullmatch(repository)
    ):
        raise ValueError("PDD execution profile repository is invalid")
    if repository and repository != job.get("repository"):
        raise ValueError("PDD execution profile belongs to another repository")
    workspace_root = safe_relative_path(snapshot.get("workspaceRoot"), "Workspace root")
    if workspace_root != snapshot.get("workspaceRoot"):
        raise ValueError("PDD execution profile workspace root is not normalized")
    if not repository and workspace_root != ".":
        raise ValueError("A workspace execution profile must use the repository root")

    config = snapshot.get("config")
    if not isinstance(config, dict):
        raise ValueError("PDD execution profile configuration is invalid")
    schema_version = config.get("schemaVersion")
    expected_keys = (
        PROFILE_CONFIG_V1_KEYS if type(schema_version) is int and schema_version == 1
        else PROFILE_CONFIG_V2_KEYS if type(schema_version) is int and schema_version == 2
        else PROFILE_CONFIG_V3_KEYS if type(schema_version) is int and schema_version == 3
        else None
    )
    if expected_keys is None or set(config) != expected_keys:
        raise ValueError("PDD execution profile configuration version is invalid")
    for label in ("language", "packageManager"):
        value = config.get(label)
        if not isinstance(value, str) or not value.strip() or len(value) > 80:
            raise ValueError(f"PDD execution profile {label} is invalid")
        if value != value.strip().lower():
            raise ValueError(f"PDD execution profile {label} is not normalized")
    for label in ("framework", "runtimeVersion"):
        value = config.get(label)
        if value is not None and (not isinstance(value, str) or not value.strip() or len(value) > 120):
            raise ValueError(f"PDD execution profile {label} is invalid")
        if value is not None and value != value.strip():
            raise ValueError(f"PDD execution profile {label} is not normalized")
    for label in ("tenkiImage", "tenkiSnapshotId"):
        value = config.get(label)
        if value is not None and (not isinstance(value, str) or not value.strip() or len(value) > 500):
            raise ValueError(f"PDD execution profile {label} is invalid")
        if value is not None and value != value.strip():
            raise ValueError(f"PDD execution profile {label} is not normalized")
    if config.get("tenkiImage") and config.get("tenkiSnapshotId"):
        raise ValueError("PDD execution profile cannot use an image and snapshot together")
    working_directory = safe_relative_path(config.get("workingDirectory"), "Working directory")
    if working_directory != config.get("workingDirectory"):
        raise ValueError("PDD execution profile working directory is not normalized")
    if not repository and working_directory != ".":
        raise ValueError("A workspace execution profile must run from the repository root")
    if workspace_root != "." and not (
        working_directory == workspace_root or working_directory.startswith(f"{workspace_root}/")
    ):
        raise ValueError("PDD execution profile working directory is outside its monorepo root")

    commands: list[str] = []
    command_groups: dict[str, list[str]] = {}
    for key in ("installCommands", "buildCommands", "testCommands", "typecheckCommands"):
        command_group = string_list(config.get(key), key, 30)
        if command_group != config.get(key):
            raise ValueError(f"PDD execution profile {key} is not normalized")
        command_groups[key] = command_group
        commands.extend(command_group)
    profile_paths = [safe_relative_path(path, "Profile permitted path") for path in string_list(config.get("permittedPaths"), "permittedPaths", 100)]
    if profile_paths != config.get("permittedPaths") or profile_paths != sorted(set(profile_paths)):
        raise ValueError("PDD execution profile permittedPaths is not normalized")
    for path in profile_paths:
        if workspace_root != "." and not path_pattern_is_narrower(path, f"{workspace_root}/**"):
            raise ValueError("PDD execution profile path is outside its monorepo root")

    for key, minimum, maximum in (
        ("cpuCores", 1, 32),
        ("memoryMb", 512, 131_072),
        ("maxDurationMs", 60_000, 86_400_000),
        ("idleTimeoutMinutes", 1, 1_440),
    ):
        value = config.get(key)
        if type(value) is not int or value < minimum or value > maximum:
            raise ValueError(f"PDD execution profile {key} is invalid")
    if type(config.get("allowInbound")) is not bool or type(config.get("allowOutbound")) is not bool:
        raise ValueError("PDD execution profile network policy is invalid")
    if schema_version in {2, 3}:
        validate_runtime_v2_config(config, command_groups)
    if schema_version == 3:
        validate_execution_profile_executor(config)

    computed_hash = digest(canonical_json(config))
    if computed_hash != profile_hash:
        raise ValueError("PDD execution profile configuration hash does not match")

    ticket_paths = [safe_relative_path(path, "Ticket permitted path") for path in string_list(job.get("permittedPaths"), "permittedPaths", 100)]
    for path in ticket_paths:
        if not any(path_pattern_is_narrower(path, allowed) for allowed in profile_paths):
            raise ValueError("PDD ticket path is broader than its execution profile")
    required_commands = string_list(job.get("requiredCommands"), "requiredCommands", 30)
    if any(command not in commands for command in required_commands):
        raise ValueError("PDD ticket command is not allowed by its execution profile")
    return snapshot


def validate_execution_profile_executor(config: dict) -> None:
    """Validate the immutable executor contract added by profile schema v3."""
    executor = config.get("executor")
    if not isinstance(executor, dict) or not isinstance(executor.get("kind"), str):
        raise ValueError("PDD execution profile executor is invalid")
    if executor["kind"] == "tenki_sandbox":
        if set(executor) != {"kind"}:
            raise ValueError("PDD Tenki Sandbox executor is invalid")
        return
    if executor["kind"] != "tenki_github_actions" or set(executor) != {
        "kind", "platform", "architecture", "runnerLabel", "workflowPath",
        "workflowSha256", "xcode", "androidEmulator",
    }:
        raise ValueError("PDD GitHub Actions executor is invalid")
    if executor["platform"] not in {"linux", "macos"}:
        raise ValueError("PDD GitHub Actions platform is invalid")
    if executor["architecture"] not in {"x64", "arm64"}:
        raise ValueError("PDD GitHub Actions architecture is invalid")
    if not isinstance(executor["runnerLabel"], str) or not re.fullmatch(
        r"[A-Za-z0-9_.-]{1,120}", executor["runnerLabel"],
    ):
        raise ValueError("PDD GitHub Actions runner label is invalid")
    if not isinstance(executor["workflowPath"], str) or not re.fullmatch(
        r"\.github/workflows/[A-Za-z0-9_.-]+\.ya?ml", executor["workflowPath"],
    ):
        raise ValueError("PDD GitHub Actions workflow path is invalid")
    workflow_hash = executor["workflowSha256"]
    if workflow_hash is not None and (
        not isinstance(workflow_hash, str)
        or not re.fullmatch(r"[a-f0-9]{64}", workflow_hash)
    ):
        raise ValueError("PDD GitHub Actions workflow hash is invalid")
    if config.get("tenkiImage") or config.get("tenkiSnapshotId"):
        raise ValueError("PDD GitHub Actions profiles cannot use a Sandbox boot source")
    if config.get("allowInbound") or config.get("previewEnabled"):
        raise ValueError("PDD GitHub Actions profiles cannot expose an inbound preview")
    if config.get("secretBindings"):
        raise ValueError("PDD GitHub Actions profiles cannot export runtime secret bindings")
    xcode = executor["xcode"]
    android = executor["androidEmulator"]
    if executor["platform"] == "macos":
        if executor["architecture"] != "arm64" or not isinstance(xcode, dict) or android is not None:
            raise ValueError("PDD macOS executor requires an arm64 Xcode contract")
        if set(xcode) != {
            "version", "containerKind", "containerPath", "scheme", "configuration",
            "destination", "sdk", "signingPolicy",
        }:
            raise ValueError("PDD Xcode executor contract is invalid")
        if xcode["containerKind"] not in {"project", "workspace"}:
            raise ValueError("PDD Xcode container kind is invalid")
        if xcode["sdk"] != "iphonesimulator" or xcode["signingPolicy"] != "simulator_only":
            raise ValueError("PDD Xcode executor must use simulator-only signing")
        if safe_relative_path(xcode["containerPath"], "Xcode container path") != xcode["containerPath"]:
            raise ValueError("PDD Xcode container path is not normalized")
        for key in ("version", "scheme", "configuration", "destination"):
            if not isinstance(xcode[key], str) or not xcode[key].strip() or len(xcode[key]) > 500:
                raise ValueError(f"PDD Xcode {key} is invalid")
    elif xcode is not None:
        raise ValueError("PDD Xcode executor requires a macOS runner")
    if android is not None:
        if executor["platform"] != "linux" or executor["architecture"] != "x64":
            raise ValueError("PDD Android Emulator executor requires Linux x64")
        if not isinstance(android, dict) or set(android) != {
            "apiLevel", "target", "architecture", "deviceProfile", "gradleTask",
        }:
            raise ValueError("PDD Android Emulator contract is invalid")
        if type(android["apiLevel"]) is not int or not 21 <= android["apiLevel"] <= 99:
            raise ValueError("PDD Android Emulator API level is invalid")
        if android["target"] not in {"google_apis", "google_apis_playstore", "default"}:
            raise ValueError("PDD Android Emulator target is invalid")
        if android["architecture"] not in {"x86_64", "arm64-v8a"}:
            raise ValueError("PDD Android Emulator architecture is invalid")
        if not isinstance(android["deviceProfile"], str) or not android["deviceProfile"].strip() or len(android["deviceProfile"]) > 120:
            raise ValueError("PDD Android Emulator device profile is invalid")
        if not isinstance(android["gradleTask"], str) or not re.fullmatch(r":[A-Za-z0-9_.:-]+", android["gradleTask"]):
            raise ValueError("PDD Android Emulator Gradle task is invalid")


def validate_job(job: object) -> dict:
    if not isinstance(job, dict):
        raise ValueError("Invalid PDD job")
    required = {
        "orgId", "verificationId", "repository", "baseSha", "promptId",
        "promptHash", "pddPrompt", "pddVersion", "executionProfileId",
        "executionProfileHash", "executionProfileSnapshot", "budgetUsd",
        "repositoryArchiveUrl", "permittedPaths", "requiredCommands",
        "suspectedFiles", "callbackUrl",
    }
    if job.get("schemaVersion") != 2 or not required.issubset(job):
        raise ValueError("Invalid PDD job")
    if not PDD_CLI_VERSION:
        raise ValueError("PDD runner version is not initialized")
    if job["pddVersion"] != PDD_CLI_VERSION:
        raise ValueError("PDD job version does not match the installed runner version")
    if not isinstance(job["repository"], str) or not REPOSITORY_NAME.fullmatch(job["repository"]):
        raise ValueError("Invalid PDD repository")
    if not isinstance(job["baseSha"], str) or len(job["baseSha"]) != 40 or any(
        character not in "0123456789abcdef" for character in job["baseSha"]
    ):
        raise ValueError("Invalid PDD base SHA")
    if not isinstance(job["promptHash"], str) or len(job["promptHash"]) != 64:
        raise ValueError("Invalid PDD prompt hash")
    if not isinstance(job["budgetUsd"], (int, float)) or isinstance(job["budgetUsd"], bool) or not 0 <= float(job["budgetUsd"]) <= 100:
        raise ValueError("Invalid PDD budget")
    safe_archive_url(job["repositoryArchiveUrl"])
    safe_callback_url(job["callbackUrl"])
    validate_execution_profile(job)
    return job


def safe_archive_url(value: str) -> str:
    parsed = urllib.parse.urlparse(value)
    allowed = (
        parsed.hostname == "github.com"
        or parsed.hostname == "api.github.com"
        or parsed.hostname == "codeload.github.com"
        or (parsed.hostname or "").endswith(".githubusercontent.com")
    )
    if parsed.scheme != "https" or not allowed or parsed.username or parsed.password:
        raise ValueError("Repository archive URL is not an approved GitHub HTTPS URL")
    return value


def safe_callback_url(value: str) -> str:
    parsed = urllib.parse.urlparse(value)
    expected = urllib.parse.urlparse(CALLBACK_ORIGIN)
    if (
        not CALLBACK_ORIGIN
        or parsed.scheme != expected.scheme
        or parsed.netloc != expected.netloc
        or not parsed.path.startswith("/api/internal/pdd-verifications/")
        or parsed.username
        or parsed.password
    ):
        raise ValueError("PDD callback URL is outside the configured CloseSpan origin")
    return value


def download_archive(url: str) -> bytes:
    request = urllib.request.Request(safe_archive_url(url), headers={"User-Agent": "CloseSpan-PDD-Runner/1"})
    with urllib.request.urlopen(request, timeout=30) as response:
        declared = int(response.headers.get("content-length", "0"))
        if declared > MAX_ARCHIVE_BYTES:
            raise ValueError("Repository archive exceeds 50 MB")
        content = response.read(MAX_ARCHIVE_BYTES + 1)
    if len(content) > MAX_ARCHIVE_BYTES:
        raise ValueError("Repository archive exceeds 50 MB")
    return content


def extract_archive(content: bytes, destination: pathlib.Path) -> None:
    with tarfile.open(fileobj=io.BytesIO(content), mode="r:gz") as archive:
        members = archive.getmembers()
        if any(item.issym() or item.islnk() or item.isdev() for item in members):
            raise ValueError("Repository archive contains a prohibited link or device")
        roots = {pathlib.PurePosixPath(item.name).parts[0] for item in members if item.name}
        if len(roots) != 1:
            raise ValueError("Repository archive must contain one root directory")
        root = next(iter(roots))
        for item in members:
            parts = pathlib.PurePosixPath(item.name).parts
            relative = pathlib.PurePosixPath(*parts[1:])
            if relative.is_absolute() or ".." in relative.parts:
                raise ValueError("Repository archive contains an unsafe path")
            item.name = str(relative)
        archive.extractall(destination, members=members, filter="data")


def language_for(path: pathlib.Path) -> tuple[str, str]:
    suffix = path.suffix.lower()
    if suffix == ".tsx":
        return "TypeScript", f"{path.stem}.pdd.test.tsx"
    if suffix == ".ts":
        return "TypeScript", f"{path.stem}.pdd.test.ts"
    if suffix in {".js", ".jsx"}:
        return "JavaScript", f"{path.stem}.pdd.test{suffix}"
    if suffix == ".py":
        return "Python", f"tests/test_{path.stem}_pdd.py"
    if suffix == ".go":
        return "Go", f"{path.stem}_pdd_test.go"
    if suffix == ".swift":
        return "Swift", "CloseSpanPDDTests.swift"
    raise ValueError(f"PDD runner does not support the target extension {suffix}")


def choose_target(
    root: pathlib.Path,
    suspected: list[str],
    permitted_outputs: list[str] | None = None,
) -> tuple[pathlib.Path, str, pathlib.Path]:
    for candidate in suspected:
        relative = pathlib.PurePosixPath(candidate)
        if relative.is_absolute() or ".." in relative.parts:
            continue
        target = root.joinpath(*relative.parts)
        if not target.is_file() or target.stat().st_size > 1_000_000:
            continue
        try:
            language, output_name = language_for(relative)
        except ValueError:
            continue
        if language == "Swift":
            project_root = next(
                (
                    parent
                    for parent in (target.parent, *target.parents)
                    if parent == root or any(parent.glob("*.xcodeproj"))
                ),
                root,
            )
            output = project_root.relative_to(root) / "tests" / output_name
        else:
            output = relative.parent / output_name
        if permitted_outputs and not permitted(output.as_posix(), permitted_outputs):
            continue
        return target, language, pathlib.Path(str(output))
    raise ValueError("No supported suspected source file exists in the repository snapshot")


def permitted(path: str, patterns: list[str]) -> bool:
    return any(fnmatch.fnmatchcase(path, pattern) for pattern in patterns)


def cost_report(
    path: pathlib.Path, fallback_model: str | None = None,
) -> tuple[float | None, str | None]:
    repair_path = path.with_name(f"{path.name}.contract-repair.json")
    if not path.exists() and not repair_path.exists():
        return None, fallback_model or PDD_MODEL or None
    total = 0.0
    model = fallback_model or PDD_MODEL or None
    if path.exists():
        with path.open(newline="", encoding="utf-8") as handle:
            for row in csv.DictReader(handle):
                try:
                    total += float(row.get("cost") or 0)
                except ValueError:
                    pass
                model = row.get("resolved_model") or row.get("model") or model
    if repair_path.exists():
        try:
            repair = json.loads(repair_path.read_text(encoding="utf-8"))
            total += float(repair.get("cost") or 0)
            model = repair.get("model") or model
        except (OSError, TypeError, ValueError, json.JSONDecodeError):
            pass
    return round(total, 6), model


def local_pdd_model(runtime: dict | None) -> str | None:
    if not runtime:
        return PDD_MODEL or None
    provider = runtime["provider"]
    prefix = WORKSPACE_LOCAL_PROVIDERS[provider][1]
    model = runtime["model"]
    bare_model = model.removeprefix(f"{prefix}/")
    if provider == "openai":
        # CloseSpan's Codex runtime exposes service-tier aliases such as
        # gpt-5.6-sol. Prompt Driven's OpenAI catalog uses the public API model
        # family name (gpt-5.6); the service tier is not part of that model ID.
        match = re.fullmatch(r"(gpt-\d+(?:\.\d+)?)-(sol|terra|luna)", bare_model)
        if match and match.group(2) in OPENAI_CODEX_SERVICE_TIERS:
            bare_model = match.group(1)
    return f"{prefix}/{bare_model}"


def pdd_environment(
    mode: str,
    budget_usd: float,
    *,
    local_runtime: dict | None = None,
    isolate_local_credentials: bool = False,
    output_token_cap: int | None = None,
) -> dict[str, str]:
    environment = os.environ.copy()
    environment["PDD_NO_INTERACTIVE"] = "1"
    environment["PDD_ALLOW_INTERACTIVE"] = "0"
    environment["PDD_COMMAND_MAX_COST_USD"] = f"{budget_usd:.6f}"
    environment.pop("PDD_COMMAND_MAX_OUTPUT_TOKENS", None)
    if output_token_cap is not None:
        if output_token_cap <= 0:
            raise ValueError("PDD output token cap must be positive")
        environment["PDD_COMMAND_MAX_OUTPUT_TOKENS"] = str(output_token_cap)
    selected_model = local_pdd_model(local_runtime)
    if selected_model:
        environment["PDD_MODEL_DEFAULT"] = selected_model
    if mode == "cloud":
        environment.pop("PDD_FORCE_LOCAL", None)
        environment.pop("PDD_REFRESH_TOKEN", None)
        if PDD_REFRESH_TOKEN:
            # Startup persists the refresh credential in PDD's keyring. Prefer
            # that durable credential so an injected one-hour JWT cannot pin an
            # unattended runner to an expired access token.
            environment.pop("PDD_JWT_TOKEN", None)
        elif PDD_JWT_TOKEN:
            environment["PDD_JWT_TOKEN"] = PDD_JWT_TOKEN
        environment["PDD_CLOUD_RUN"] = "true"
        # Prevent the PDD CLI from silently switching to a directly billed model
        # provider. CloseSpan owns the fallback decision and reports it explicitly.
        for name in LOCAL_PROVIDER_CREDENTIALS:
            environment.pop(name, None)
    else:
        environment["PDD_FORCE_LOCAL"] = "1"
        environment["PDD_CLOUD_RUN"] = "false"
        if isolate_local_credentials:
            # Prompt evaluations are tenant-scoped. Never allow a job without
            # an explicit workspace runtime to inherit another credential from
            # the runner process.
            for name in LOCAL_PROVIDER_CREDENTIALS:
                environment.pop(name, None)
            environment.pop("PDD_MODEL_DEFAULT", None)
            if local_runtime:
                credential_name = WORKSPACE_LOCAL_PROVIDERS[
                    local_runtime["provider"]
                ][0]
                credential_value = local_runtime.get("apiKey")
                if local_runtime.get("credentialSource") == "runner":
                    credential_value = os.environ.get(credential_name, "").strip()
                if not credential_value:
                    raise ValueError(
                        f"The runner credential for {local_runtime['provider']} is not configured"
                    )
                environment[credential_name] = credential_value
                environment["PDD_MODEL_DEFAULT"] = local_pdd_model(local_runtime) or ""
    return environment


def configure_cloud_credentials() -> None:
    """Persist the injected refresh credential for unattended PDD CLI refreshes."""
    if not PDD_REFRESH_TOKEN:
        return
    os.environ.setdefault(
        "PYTHON_KEYRING_BACKEND", "keyrings.alt.file.PlaintextKeyring"
    )
    try:
        import keyring

        keyring.set_password(
            "firebase-auth-PDD CLI", "refresh_token", PDD_REFRESH_TOKEN
        )
    except Exception as error:
        raise RuntimeError("Could not configure the PDD Cloud credential") from error


def pdd_command(
    *, mode: str, costs: pathlib.Path, language: str, output: str,
    prompt: pathlib.Path, target: pathlib.Path,
) -> list[str]:
    command = ["pdd"]
    if mode == "local":
        command.append("--local")
    command.extend([
        "--force", "--quiet", "--no-core-dump", "--output-cost", str(costs),
        "test", "--manual", "--language", language, "--output", output,
        prompt.name, target.as_posix(),
    ])
    return command


def validate_prompt_evaluation(value: object) -> dict:
    required_fields = {
        "schemaVersion", "requestId", "promptHash", "userStory",
        "implementationPrompt", "pddVersion", "budgetUsd",
    }
    optional_fields = {"evaluationMode", "localRuntime", "acceptanceContract"}
    if (
        not isinstance(value, dict)
        or not required_fields.issubset(value)
        or not set(value).issubset(required_fields | optional_fields)
    ):
        raise ValueError("PDD prompt evaluation payload is invalid")
    if value["schemaVersion"] != 1:
        raise ValueError("PDD prompt evaluation schema is unsupported")
    if not valid_uuid(value["requestId"]):
        raise ValueError("PDD prompt evaluation request ID is invalid")
    if not isinstance(value["promptHash"], str) or not re.fullmatch(r"[a-f0-9]{64}", value["promptHash"]):
        raise ValueError("PDD prompt evaluation hash is invalid")
    for field, limit in (("userStory", 8_000), ("implementationPrompt", 64_000)):
        item = value[field]
        if not isinstance(item, str) or not item.strip() or len(item.encode()) > limit:
            raise ValueError(f"PDD prompt evaluation {field} is invalid")
        if "\x00" in item:
            raise ValueError(f"PDD prompt evaluation {field} is invalid")
        value[field] = item.strip()
    if value["pddVersion"] != PDD_CLI_VERSION:
        raise ValueError("PDD prompt evaluation version does not match the runner")
    acceptance_contract = value.get("acceptanceContract")
    if acceptance_contract is not None:
        if (
            not isinstance(acceptance_contract, str)
            or not acceptance_contract.strip()
            or len(acceptance_contract.encode()) > MAX_OUTPUT_BYTES
            or "\x00" in acceptance_contract
        ):
            raise ValueError("PDD acceptance contract is invalid")
        required_headings = {
            match.group(1).strip().casefold()
            for match in re.finditer(r"^##\s+([^\n]+?)\s*$", acceptance_contract, re.MULTILINE)
        }
        if not all(name.casefold() in required_headings for name in PROMPT_CONTRACT_CHANGE_SECTIONS):
            raise ValueError("PDD acceptance contract is incomplete")
        value["acceptanceContract"] = acceptance_contract.strip()
    budget = value["budgetUsd"]
    if isinstance(budget, bool) or not isinstance(budget, (int, float)) or not 0 < float(budget) <= 5:
        raise ValueError("PDD prompt evaluation budget is invalid")
    value["budgetUsd"] = float(budget)
    if "evaluationMode" not in value:
        value["evaluationMode"] = (
            "pdd_local" if PDD_EXECUTION_MODE == "local"
            else "pdd_cloud_with_local_fallback"
            if PDD_CLOUD_FALLBACK_ENABLED
            else "pdd_cloud"
        )
    if value["evaluationMode"] not in PROMPT_EVALUATION_MODES:
        raise ValueError("PDD prompt evaluation mode is invalid")
    runtime = value.get("localRuntime")
    if value["evaluationMode"] == "pdd_local" and runtime is None:
        raise ValueError("PDD local runtime is required")
    if runtime is not None:
        if value["evaluationMode"] == "pdd_cloud":
            raise ValueError("PDD Cloud evaluations cannot receive local credentials")
        runtime_fields = set(runtime) if isinstance(runtime, dict) else set()
        if runtime_fields not in (
            {"provider", "model", "apiKey"},
            {"provider", "model", "credentialSource"},
        ):
            raise ValueError("PDD local runtime is invalid")
        if runtime["provider"] not in WORKSPACE_LOCAL_PROVIDERS:
            raise ValueError("PDD local provider is unsupported")
        if (
            not isinstance(runtime["model"], str)
            or not PDD_MODEL_NAME.fullmatch(runtime["model"])
        ):
            raise ValueError("PDD local model is invalid")
        if "apiKey" in runtime:
            if (
                not isinstance(runtime["apiKey"], str)
                or not 8 <= len(runtime["apiKey"]) <= 8_192
                or any(character in runtime["apiKey"] for character in ("\x00", "\n", "\r"))
            ):
                raise ValueError("PDD local credential is invalid")
        elif runtime.get("credentialSource") != "runner":
            raise ValueError("PDD local credential source is invalid")
    return value


def validate_prompt_evaluation_status(value: object) -> dict:
    if not isinstance(value, dict) or set(value) != {
        "schemaVersion", "requestId", "promptHash",
    }:
        raise ValueError("PDD prompt evaluation status payload is invalid")
    if value["schemaVersion"] != 1 or not valid_uuid(value["requestId"]):
        raise ValueError("PDD prompt evaluation status payload is invalid")
    if not isinstance(value["promptHash"], str) or not re.fullmatch(
        r"[a-f0-9]{64}", value["promptHash"]
    ):
        raise ValueError("PDD prompt evaluation status payload is invalid")
    return value


def prune_prompt_evaluations(now: float) -> None:
    expired = [
        request_id for request_id, record in PROMPT_EVALUATIONS.items()
        if record["status"] in {"Complete", "Failed"}
        and now - record["updatedAt"] >= PROMPT_EVALUATION_RETENTION_SECONDS
    ]
    for request_id in expired:
        PROMPT_EVALUATIONS.pop(request_id, None)
    if len(PROMPT_EVALUATIONS) < MAX_PROMPT_EVALUATIONS:
        return
    terminal = sorted(
        (
            (record["updatedAt"], request_id)
            for request_id, record in PROMPT_EVALUATIONS.items()
            if record["status"] in {"Complete", "Failed"}
        ),
    )
    for _, request_id in terminal:
        PROMPT_EVALUATIONS.pop(request_id, None)
        if len(PROMPT_EVALUATIONS) < MAX_PROMPT_EVALUATIONS:
            break


def register_prompt_evaluation(job: dict) -> bool:
    now = time.monotonic()
    with PROMPT_EVALUATION_LOCK:
        prune_prompt_evaluations(now)
        existing = PROMPT_EVALUATIONS.get(job["requestId"])
        if existing:
            return existing["promptHash"] == job["promptHash"]
        if len(PROMPT_EVALUATIONS) >= MAX_PROMPT_EVALUATIONS:
            return False
        PROMPT_EVALUATIONS[job["requestId"]] = {
            "promptHash": job["promptHash"],
            "status": "Queued",
            "updatedAt": now,
        }
        return True


def prompt_evaluation_status(request_id: str, prompt_hash: str) -> dict | None:
    with PROMPT_EVALUATION_LOCK:
        record = PROMPT_EVALUATIONS.get(request_id)
        if not record or record["promptHash"] != prompt_hash:
            return None
        return dict(record)


def update_prompt_evaluation(request_id: str, **values: object) -> None:
    with PROMPT_EVALUATION_LOCK:
        record = PROMPT_EVALUATIONS.get(request_id)
        if not record:
            return
        record.update(values)
        record["updatedAt"] = time.monotonic()


def pdd_detect_command(*, mode: str, costs: pathlib.Path) -> list[str]:
    command = ["pdd"]
    if mode == "local":
        command.append("--local")
    command.extend([
        "--force", "--quiet", "--no-core-dump", "--output-cost", str(costs),
        "detect", "--stories", "--stories-dir", "user_stories",
        "--prompts-dir", "prompts", "--json", "--read-only", "--non-interactive",
    ])
    return command


def pdd_story_command(
    *, mode: str, costs: pathlib.Path, issue: pathlib.Path,
) -> list[str]:
    """Build the official PDD command that derives a contract from the PM story."""
    command = ["pdd"]
    if mode == "local":
        command.append("--local")
    command.extend([
        "--force", "--quiet", "--no-core-dump", "--output-cost", str(costs),
        "story", "add", issue.as_posix(), "--title", "Requested outcome",
        "--prompt", "prompts/suggested.prompt", "--stories-dir", "user_stories",
        "--prompts-dir", "prompts",
    ])
    return command


def pdd_contract_repair_command(
    *, story: pathlib.Path, issue: pathlib.Path, prompts: pathlib.Path,
) -> list[str]:
    """Regenerate a missing contract through Prompt Driven's supported API."""
    script = """
import json
import pathlib
import sys
from pdd.user_story_tests import sync_user_story_contract

changed, message, cost, model, contract_path = sync_user_story_contract(
    sys.argv[1],
    issue=sys.argv[2],
    prompts_dir=sys.argv[3],
    time=0.5,
    force=True,
)
result = {
    "changed": bool(changed),
    "message": str(message or ""),
    "cost": float(cost or 0),
    "model": str(model or ""),
    "contractPath": str(contract_path or ""),
}
print("CLOSESPAN_CONTRACT_REPAIR=" + json.dumps(result, separators=(",", ":")))
if not contract_path or not pathlib.Path(contract_path).is_file():
    raise SystemExit(1)
""".strip()
    return [
        "python", "-c", script, story.as_posix(), issue.as_posix(),
        prompts.as_posix(),
    ]


def pdd_contract_repair_receipt(output: str) -> dict | None:
    """Extract PDD's bounded repair receipt from otherwise noisy CLI output."""
    marker = "CLOSESPAN_CONTRACT_REPAIR="
    marker_index = output.rfind(marker)
    receipt = output[marker_index + len(marker):].lstrip() if marker_index >= 0 else ""
    if not receipt:
        return None
    try:
        result, _ = json.JSONDecoder().raw_decode(receipt)
    except json.JSONDecodeError:
        return None
    return result if isinstance(result, dict) else None


def log_contract_repair_failure(
    *, mode: str, process: subprocess.CompletedProcess[str],
) -> None:
    """Log only PDD-authored, bounded metadata; never log prompts or credentials."""
    result = pdd_contract_repair_receipt(process.stdout)
    if not result:
        return
    message = re.sub(r"/[A-Za-z0-9_./-]+", "<path>", str(result.get("message") or ""))
    for pattern in CREDENTIAL_VALUE_PATTERNS:
        message = pattern.sub("[redacted]", message)
    print(json.dumps({
        "event": "pdd_contract_repair_failed",
        "mode": mode,
        "returnCode": process.returncode,
        "model": str(result.get("model") or "")[:200],
        "message": message[:1_000],
    }, separators=(",", ":")))


def log_pdd_stage_failure(
    *, stage: str, mode: str, process: subprocess.CompletedProcess[str],
) -> None:
    """Emit bounded provider diagnostics without prompts, paths, or credentials."""
    relevant = []
    for line in "\n".join((process.stdout or "", process.stderr or "")).splitlines():
        if not re.search(
            r"error|exception|model|provider|budget|cost|credential|api.?key|unauthor|invalid|unavailable|failed",
            line,
            re.IGNORECASE,
        ):
            continue
        sanitized = re.sub(r"\x1b\[[0-9;]*m", "", line)
        sanitized = re.sub(r"/[A-Za-z0-9_./-]+", "<path>", sanitized)
        for pattern in CREDENTIAL_VALUE_PATTERNS:
            sanitized = pattern.sub("[redacted]", sanitized)
        relevant.append(sanitized[:500])
    print(json.dumps({
        "event": "pdd_stage_failed",
        "stage": stage,
        "mode": mode,
        "returnCode": process.returncode,
        "diagnostic": relevant[-8:],
    }, separators=(",", ":")))


def prompt_evaluation_story(root: pathlib.Path) -> pathlib.Path:
    """Return the one bounded story artifact available for contract repair."""
    stories = sorted(
        path for path in (root / "user_stories").rglob("story__*.md")
        if path.is_file() and not path.is_symlink()
    )
    if len(stories) != 1:
        raise RuntimeError("PDD did not produce the required prompt-evaluation story")
    if not 0 < stories[0].stat().st_size <= MAX_OUTPUT_BYTES:
        raise RuntimeError("PDD produced an invalid prompt-evaluation story")
    return stories[0]


def repair_prompt_evaluation_contract(
    *, root: pathlib.Path, mode: str, budget_usd: float, costs: pathlib.Path,
    local_runtime: dict | None = None,
) -> None:
    """Make one bounded repair attempt when PDD's best-effort add skips a contract."""
    story = prompt_evaluation_story(root)
    process = subprocess.run(
        pdd_contract_repair_command(
            story=story,
            issue=root / "requested-outcome.md",
            prompts=root / "prompts",
        ),
        cwd=root,
        env=pdd_environment(
            mode,
            budget_usd,
            local_runtime=local_runtime,
            isolate_local_credentials=True,
            output_token_cap=PROMPT_EVALUATION_MAX_OUTPUT_TOKENS,
        ),
        capture_output=True,
        text=True,
        timeout=RUN_TIMEOUT_SECONDS,
        check=False,
    )
    if process.returncode != 0:
        log_contract_repair_failure(mode=mode, process=process)
        raise pdd_prompt_stage_error(
            "contract-regeneration", process, mode=mode,
        )
    try:
        result = pdd_contract_repair_receipt(process.stdout)
        if not isinstance(result, dict):
            raise TypeError("contract repair receipt is missing")
        repair_cost = float(result.get("cost") or 0)
        repair_model = result.get("model") or ""
    except (AttributeError, TypeError, ValueError, json.JSONDecodeError) as exc:
        raise RuntimeError(
            "PDD returned an invalid contract-regeneration receipt"
        ) from exc
    if repair_cost < 0 or repair_cost > budget_usd:
        raise RuntimeError("PDD contract regeneration exceeded its review budget")
    costs.with_name(f"{costs.name}.contract-repair.json").write_text(
        json.dumps({"cost": repair_cost, "model": repair_model}),
        encoding="utf-8",
    )
    prompt_evaluation_artifacts(root)


def prompt_evaluation_artifacts(root: pathlib.Path) -> tuple[pathlib.Path, pathlib.Path]:
    """Return the one complete story/contract pair authored for an evaluation."""
    stories_root = root / "user_stories"
    story_files = sorted(
        path for path in stories_root.rglob("story__*.md")
        if path.is_file() and not path.is_symlink()
    )
    contract_files = sorted(
        path for path in (stories_root / "contracts").rglob("*.contract.md")
        if path.is_file() and not path.is_symlink()
    )
    if len(story_files) != 1 or len(contract_files) != 1:
        raise RuntimeError("PDD did not produce the required prompt-evaluation contract")
    story = story_files[0]
    slug = story.name.removeprefix("story__").removesuffix(".md")
    expected_contract = story.parent / "contracts" / f"{slug}.contract.md"
    if contract_files[0] != expected_contract:
        raise RuntimeError("PDD produced an inconsistent prompt-evaluation contract")
    for artifact in (story, expected_contract):
        size = artifact.stat().st_size
        if size <= 0 or size > MAX_OUTPUT_BYTES:
            raise RuntimeError("PDD produced an invalid prompt-evaluation contract")
    return story, expected_contract


def seed_prompt_evaluation_artifacts(
    *, root: pathlib.Path, user_story: str, acceptance_contract: str,
) -> tuple[pathlib.Path, pathlib.Path]:
    """Restore the immutable story/contract pair used by a prompt retest.

    The application persists PDD's acceptance contract after the first review.
    A retest must evaluate that exact boundary, so generating another contract is
    both incorrect and an avoidable provider call.  The small story file only
    supplies the human outcome and the stable prompt link expected by PDD; the
    saved contract remains the complete machine-owned oracle.
    """
    stories = root / "user_stories"
    contracts = stories / "contracts"
    contracts.mkdir(parents=True, exist_ok=True)
    story = stories / "story__requested_outcome.md"
    contract = contracts / "requested_outcome.contract.md"
    normalized_story = re.sub(
        r"\A#\s+Requested outcome\s*", "", user_story.strip(), flags=re.IGNORECASE,
    ).strip()
    story.write_text(
        "<!-- pdd-story-prompts: suggested.prompt -->\n\n"
        "# User Story: Requested outcome\n\n"
        f"## Story\n\n{normalized_story}\n",
        encoding="utf-8",
    )
    contract.write_text(acceptance_contract.strip() + "\n", encoding="utf-8")
    return prompt_evaluation_artifacts(root)


def pdd_prompt_stage_error(
    stage: str, process: subprocess.CompletedProcess[str], *, mode: str = "cloud",
) -> RuntimeError:
    """Map PDD CLI diagnostics to a safe, actionable runner error."""
    details = " ".join(
        part for part in (process.stdout, process.stderr) if isinstance(part, str)
    ).lower()
    if "authentication" in details or "token expired" in details:
        return RuntimeError("PDD Cloud authentication could not be refreshed")
    if any(phrase in details for phrase in (
        "budget exceeded", "budget exhausted", "budget cannot fund",
        "cost limit", "maximum cost", "max cost", "output token ceiling is exhausted",
        "exceeded the configured", "insufficient pddc",
    )):
        if mode == "local":
            return RuntimeError(
                "Local Prompt Driven evaluation could not complete within its bounded review budget"
            )
        return RuntimeError("PDD Cloud could not complete prompt evaluation within its budget")
    if mode == "local" and any(phrase in details for phrase in (
        "no matching row", "choose an available model", "not found in csv",
        "requires api key", "no models available",
    )):
        return RuntimeError(
            "The configured AI model is not supported by Prompt Driven; choose a compatible model in AI Settings"
        )
    if mode == "cloud" and (
        "no models" in details or "model" in details and "unavailable" in details
    ):
        return RuntimeError("PDD Cloud could not select an evaluation model")
    return RuntimeError(f"PDD could not complete the {stage} stage")


def verify_pdd_cloud_authentication(*, mode: str, budget_usd: float) -> None:
    """Proactively refresh PDD Cloud auth before an unattended command."""
    if mode != "cloud":
        return
    process = subprocess.run(
        ["pdd", "auth", "status", "--verify"],
        env=pdd_environment(mode, budget_usd), capture_output=True, text=True,
        timeout=60, check=False,
    )
    if process.returncode != 0:
        raise pdd_prompt_stage_error("authentication", process)


def run_prompt_evaluation_pipeline(
    *, root: pathlib.Path, mode: str, budget_usd: float, costs: pathlib.Path,
    local_runtime: dict | None = None, acceptance_contract: str | None = None,
) -> subprocess.CompletedProcess[str]:
    """Generate PDD's independent contract, then evaluate the suggested prompt."""
    issue = root / "requested-outcome.md"
    # The final detector reads the complete generated contract plus Prompt
    # Driven's evaluation template. Contract generation already succeeds with
    # a small cap, so do not scale those two preparatory stages up with the
    # larger local ceiling; reserve the remainder for the detector.
    generation_budget, repair_budget, _detection_budget = (
        prompt_evaluation_stage_budgets(budget_usd)
    )
    if acceptance_contract:
        # A retest must use the immutable contract authored by the preceding
        # PDD review. Regenerating it would move the acceptance boundary after
        # the product manager applied the requested revision and can spend the
        # entire request timeout before the actual detector starts.
        seed_prompt_evaluation_artifacts(
            root=root,
            user_story=(root / "requested-outcome.md").read_text(encoding="utf-8"),
            acceptance_contract=acceptance_contract,
        )
    else:
        verify_pdd_cloud_authentication(mode=mode, budget_usd=generation_budget)
        generation = subprocess.run(
            pdd_story_command(mode=mode, costs=costs, issue=issue), cwd=root,
            env=pdd_environment(
                mode,
                generation_budget,
                local_runtime=local_runtime,
                isolate_local_credentials=True,
                output_token_cap=PROMPT_EVALUATION_MAX_OUTPUT_TOKENS,
            ), capture_output=True,
            text=True, timeout=RUN_TIMEOUT_SECONDS, check=False,
        )
        if generation.returncode != 0:
            log_pdd_stage_failure(
                stage="contract-generation", mode=mode, process=generation,
            )
            raise pdd_prompt_stage_error(
                "contract-generation", generation, mode=mode,
            )

        try:
            prompt_evaluation_artifacts(root)
        except RuntimeError as error:
            if "required prompt-evaluation contract" not in str(error):
                raise
            repair_prompt_evaluation_contract(
                root=root,
                mode=mode,
                budget_usd=repair_budget,
                costs=costs,
                local_runtime=local_runtime,
            )

    # Give the detector the real unspent remainder. A repair is best-effort and
    # usually does not run, so permanently reserving its entire ceiling made
    # otherwise valid local evaluations fail before the provider was invoked.
    # The final cost check still enforces the request-wide hard ceiling.
    preparation_cost, _preparation_model = cost_report(
        costs,
        fallback_model=local_pdd_model(local_runtime),
    )
    detection_budget = round(budget_usd - float(preparation_cost or 0), 6)
    if detection_budget <= 0:
        raise RuntimeError(
            "PDD preparation exhausted the prompt evaluation review budget"
        )
    if acceptance_contract:
        verify_pdd_cloud_authentication(mode=mode, budget_usd=detection_budget)

    detection = subprocess.run(
        pdd_detect_command(mode=mode, costs=costs), cwd=root,
        env=pdd_environment(
            mode,
            detection_budget,
            local_runtime=local_runtime,
            isolate_local_credentials=True,
            output_token_cap=PROMPT_EVALUATION_DETECTION_MAX_OUTPUT_TOKENS,
        ), capture_output=True,
        text=True, timeout=RUN_TIMEOUT_SECONDS, check=False,
    )
    if detection.returncode not in {0, 1}:
        log_pdd_stage_failure(
            stage="prompt-detection", mode=mode, process=detection,
        )
        raise pdd_prompt_stage_error("prompt-detection", detection, mode=mode)
    return detection


def prompt_evaluation_stage_budgets(budget_usd: float) -> tuple[float, float, float]:
    generation = round(min(budget_usd * 0.25, 0.25), 6)
    repair = round(min(budget_usd * 0.15, 0.25), 6)
    detection = round(budget_usd - generation - repair, 6)
    return generation, repair, detection


def split_numbered_change_instructions(instruction: str) -> list[str]:
    compact = " ".join(instruction.split()).strip()
    if not compact:
        return []
    markers = list(re.finditer(r"(?:^|\s)\d+\.\s+(?=[A-Z\"'])", compact))
    if not markers or markers[0].start() != 0:
        return [compact]
    return [
        compact[marker.end():(markers[index + 1].start() if index + 1 < len(markers) else len(compact))].strip()
        for index, marker in enumerate(markers)
        if compact[marker.end():(markers[index + 1].start() if index + 1 < len(markers) else len(compact))].strip()
    ]


def prompt_change_is_complete(instruction: str) -> bool:
    """Reject visibly clipped PDD instructions before they reach an approval."""
    compact = instruction.rstrip()
    if not compact or compact.endswith(("...", "…")):
        return False
    return compact.endswith((".", "!", "?", ":", ")", "]", "}", '"', "'", "`"))


def contract_change_recommendations(contract: str) -> list[str]:
    """Recover complete recommendations from PDD's generated source contract."""
    headings = list(re.finditer(r"^##\s+([^\n]+?)\s*$", contract, re.MULTILINE))
    sections: dict[str, str] = {}
    for index, heading in enumerate(headings):
        name = heading.group(1).strip()
        body_end = headings[index + 1].start() if index + 1 < len(headings) else len(contract)
        body = contract[heading.end():body_end].strip()
        if body:
            sections[name.casefold()] = body

    recovered: list[str] = []
    for name in PROMPT_CONTRACT_CHANGE_SECTIONS:
        body = sections.get(name.casefold())
        if not body:
            continue
        recommendation = (
            f'Update the prompt with the complete PDD "{name}" contract section:\n\n'
            f"## {name}\n{body}"
        )
        if len(recommendation) > MAX_PROMPT_CHANGE_CHARACTERS:
            raise RuntimeError(
                f'PDD generated an oversized "{name}" contract section; retry the evaluation'
            )
        recovered.append(recommendation)
    if not recovered:
        raise RuntimeError("PDD returned incomplete change instructions without a recoverable contract")
    return recovered


def complete_story_changes(changes: list[str], contract: str) -> list[str]:
    """Use the immutable PDD contract whenever detector prose is incomplete."""
    if changes and all(prompt_change_is_complete(change) for change in changes):
        return changes
    return contract_change_recommendations(contract)


def parse_story_detection(output: str) -> tuple[str, list[str]]:
    try:
        document = json.loads(output.strip())
    except (TypeError, json.JSONDecodeError) as error:
        raise RuntimeError("PDD returned an invalid prompt-evaluation result") from error
    if not isinstance(document, dict) or document.get("schema_version") != "pdd.detect.stories.v1":
        raise RuntimeError("PDD returned an unsupported prompt-evaluation result")
    outcome = document.get("outcome")
    results = document.get("results")
    if outcome not in {"PASS", "STORY_FAILURE"}:
        stop_reason = document.get("stop_reason")
        suffix = f" ({stop_reason})" if isinstance(stop_reason, str) and stop_reason else ""
        raise RuntimeError(f"PDD could not complete prompt evaluation{suffix}")
    if not isinstance(results, list):
        raise RuntimeError("PDD returned malformed prompt-evaluation results")
    changes: list[str] = []
    for result in results[:20]:
        if not isinstance(result, dict):
            continue
        for change in result.get("changes") or []:
            if not isinstance(change, dict):
                continue
            instruction = change.get("change_instructions") or change.get("instruction")
            if isinstance(instruction, str):
                for recommendation in split_numbered_change_instructions(instruction):
                    if recommendation and recommendation not in changes:
                        if len(recommendation) > MAX_PROMPT_CHANGE_CHARACTERS:
                            raise RuntimeError("PDD returned an oversized prompt-change instruction")
                        changes.append(recommendation)
    if outcome == "STORY_FAILURE" and not changes:
        changes.append("Revise the implementation prompt so it explicitly delivers the user story's observable outcome.")
    return ("Passed" if outcome == "PASS" else "Needs revision"), changes[:8]


def evaluate_prompt_with_pdd(request: dict) -> dict:
    with tempfile.TemporaryDirectory(prefix="closespan-pdd-evaluate-") as temporary:
        root = pathlib.Path(temporary)
        prompts = root / "prompts"
        stories = root / "user_stories"
        prompts.mkdir()
        stories.mkdir()
        (prompts / "suggested.prompt").write_text(request["implementationPrompt"], encoding="utf-8")
        (root / "requested-outcome.md").write_text(
            "# Requested outcome\n\n" + request["userStory"] + "\n",
            encoding="utf-8",
        )
        costs = root / "pdd-costs.csv"
        evaluation_mode = request["evaluationMode"]
        local_runtime = request.get("localRuntime")
        mode = "local" if evaluation_mode == "pdd_local" else "cloud"
        local_fallback_enabled = (
            evaluation_mode == "pdd_cloud_with_local_fallback"
        )
        if mode == "local" and not local_runtime:
            raise RuntimeError(
                "Configure an AI provider for this workspace before using local Prompt Driven evaluation"
            )
        cloud_budget = min(request["budgetUsd"], 0.25)
        effective_budget = request["budgetUsd"] if mode == "local" else cloud_budget
        try:
            process = run_prompt_evaluation_pipeline(
                root=root, mode=mode, budget_usd=effective_budget, costs=costs,
                local_runtime=local_runtime,
                acceptance_contract=request.get("acceptanceContract"),
            )
        except RuntimeError:
            if mode != "cloud" or not local_fallback_enabled:
                raise
            costs.unlink(missing_ok=True)
            for artifact in stories.rglob("*"):
                if artifact.is_file():
                    artifact.unlink()
            if not local_runtime:
                raise RuntimeError(
                    "PDD Cloud was unavailable and this workspace has no AI provider for local fallback"
                )
            mode = "local"
            effective_budget = request["budgetUsd"]
            process = run_prompt_evaluation_pipeline(
                root=root, mode=mode, budget_usd=effective_budget, costs=costs,
                local_runtime=local_runtime,
                acceptance_contract=request.get("acceptanceContract"),
            )
        verdict, changes = parse_story_detection(process.stdout)
        acceptance_contract = request.get("acceptanceContract")
        if verdict == "Needs revision":
            _, contract_path = prompt_evaluation_artifacts(root)
            acceptance_contract = contract_path.read_text(encoding="utf-8").strip()
            changes = complete_story_changes(
                changes,
                acceptance_contract,
            )
        cost, model = cost_report(
            costs,
            local_pdd_model(local_runtime) if mode == "local" else None,
        )
        if cost is not None and cost > effective_budget:
            raise RuntimeError("PDD prompt evaluation exceeded its review budget")
        return {
            "schemaVersion": 1,
            "requestId": request["requestId"],
            "promptHash": request["promptHash"],
            "verdict": verdict,
            "changes": changes,
            **({"acceptanceContract": acceptance_contract} if acceptance_contract else {}),
            "pddVersion": PDD_CLI_VERSION,
            "executionMode": mode,
            "model": model,
            "costUsd": cost,
        }


def run_pdd(
    *, root: pathlib.Path, mode: str, budget_usd: float, costs: pathlib.Path,
    language: str, output: str, prompt: pathlib.Path, target: pathlib.Path,
) -> subprocess.CompletedProcess[str]:
    verify_pdd_cloud_authentication(mode=mode, budget_usd=budget_usd)
    return subprocess.run(
        pdd_command(
            mode=mode, costs=costs, language=language, output=output,
            prompt=prompt, target=target,
        ),
        cwd=root,
        env=pdd_environment(mode, budget_usd),
        capture_output=True,
        text=True,
        timeout=RUN_TIMEOUT_SECONDS,
        check=False,
    )


def callback(job: dict, result: dict) -> None:
    body = json.dumps({"orgId": job["orgId"], "result": result}, separators=(",", ":")).encode()
    signature = hmac.new(SHARED_SECRET, body, hashlib.sha256).hexdigest()
    request = urllib.request.Request(
        safe_callback_url(job["callbackUrl"]), data=body, method="POST",
        headers={"content-type": "application/json", "x-closespan-signature": signature},
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        if response.status >= 300:
            raise RuntimeError(f"CloseSpan callback failed with HTTP {response.status}")


def execute(job: dict) -> None:
    result = {
        "schemaVersion": 1,
        "verificationId": job["verificationId"],
        "promptHash": job["promptHash"],
        "status": "Failed",
        "pddVersion": PDD_CLI_VERSION,
        "model": PDD_MODEL or None,
        "costUsd": None,
        "summary": "PDD could not generate the acceptance contract.",
        "generatedTests": [],
        "failureMessage": "PDD runner failed before producing a safe test artifact.",
    }
    try:
        with tempfile.TemporaryDirectory(prefix="closespan-pdd-") as temporary:
            root = pathlib.Path(temporary)
            extract_archive(download_archive(job["repositoryArchiveUrl"]), root)
            target, language, output = choose_target(
                root,
                job.get("suspectedFiles", []),
                job.get("permittedPaths", []),
            )
            relative_target = target.relative_to(root)
            output_text = output.as_posix()
            if not permitted(output_text, job["permittedPaths"]):
                raise ValueError(f"Derived PDD test path is not permitted: {output_text}")
            command = next((item for item in job["requiredCommands"] if "test" in item.lower()), None)
            if not command:
                raise ValueError("The ticket has no approved test command")
            prompt = root / f"closespan_{language}.prompt"
            pdd_prompt = job["pddPrompt"]
            if language == "Swift":
                pdd_prompt += """

Swift acceptance-test contract:
- Write one standalone Swift script at the requested output path.
- It will run as `swift tests/CloseSpanPDDTests.swift` from the Xcode project root.
- Do not import XCTest or the application module, because the repository may not have a test target yet.
- Use Foundation and deterministic source/fixture assertions, print concise failure evidence, and exit non-zero when any assertion fails.
- Resolve repository files relative to the script location; never use absolute machine paths or network access.
"""
            prompt.write_text(pdd_prompt, encoding="utf-8")
            (root / output).parent.mkdir(parents=True, exist_ok=True)
            costs = root / "pdd-costs.csv"
            budget_usd = float(job["budgetUsd"])
            execution_mode = PDD_EXECUTION_MODE
            process = run_pdd(
                root=root, mode=execution_mode, budget_usd=budget_usd, costs=costs,
                language=language, output=output_text, prompt=prompt,
                target=relative_target,
            )
            if (
                process.returncode != 0
                and execution_mode == "cloud"
                and PDD_CLOUD_FALLBACK_ENABLED
            ):
                (root / output).unlink(missing_ok=True)
                costs.unlink(missing_ok=True)
                execution_mode = "local"
                process = run_pdd(
                    root=root, mode=execution_mode, budget_usd=budget_usd, costs=costs,
                    language=language, output=output_text, prompt=prompt,
                    target=relative_target,
                )
            cost, model = cost_report(costs)
            if process.returncode != 0:
                raise RuntimeError(f"PDD test generation exited with code {process.returncode}; inspect the runner's private logs")
            generated = root / output
            if not generated.is_file():
                raise RuntimeError("PDD completed without writing the requested test file")
            content = generated.read_text(encoding="utf-8")
            if not content or len(content.encode()) > MAX_OUTPUT_BYTES:
                raise RuntimeError("PDD test output is empty or too large")
            if cost is not None and cost > budget_usd:
                raise RuntimeError(f"PDD cost ${cost:.4f} exceeded the configured ${budget_usd:.4f} review budget")
            result.update({
                "status": "Ready for approval",
                "model": model,
                "costUsd": cost,
                "summary": (
                    "PDD Cloud generated one immutable repository-native acceptance test from the PM user story."
                    if execution_mode == "cloud"
                    else "PDD local fallback generated one immutable repository-native acceptance test from the PM user story."
                ),
                "generatedTests": [{
                    "path": output_text, "content": content,
                    "contentHash": digest(content), "command": command,
                }],
                "failureMessage": None,
            })
    except Exception as error:  # The signed callback carries a bounded safe message.
        result["failureMessage"] = str(error)[:5_000]
    callback(job, result)


def execute_reserved(job: dict) -> None:
    with RUN_SLOTS:
        begin_reserved_job()
        try:
            execute(job)
        finally:
            finish_job()


def execute_prompt_evaluation_reserved(job: dict) -> None:
    with RUN_SLOTS:
        begin_reserved_job()
        update_prompt_evaluation(job["requestId"], status="Running")
        try:
            result = evaluate_prompt_with_pdd(job)
            update_prompt_evaluation(
                job["requestId"], status="Complete", result=result,
            )
        except Exception as error:
            update_prompt_evaluation(
                job["requestId"], status="Failed", error=str(error)[:1_000],
            )
        finally:
            finish_job()


class Handler(BaseHTTPRequestHandler):
    server_version = "CloseSpanPDD/1"

    def send_json_error(self, status: int, message: str) -> None:
        payload = json.dumps(
            {"error": message.strip()[:1_000] or "Invalid Prompt Testing request"},
            separators=(",", ":"),
        ).encode()
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def do_GET(self) -> None:
        if self.path == "/health":
            payload = health_payload()
            self.send_response(200 if payload["status"] == "ok" else 503)
            self.send_header("content-type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps(payload).encode())
            return
        self.send_error(404)

    def do_POST(self) -> None:
        if self.path not in {
            "/verifications", "/prompt-evaluations", "/prompt-evaluations/status",
        } or not SHARED_SECRET:
            self.send_error(404)
            return
        length = int(self.headers.get("content-length", "0"))
        if length <= 0 or length > MAX_JOB_BYTES:
            self.send_error(413)
            return
        body = self.rfile.read(length)
        expected = hmac.new(SHARED_SECRET, body, hashlib.sha256).hexdigest()
        if not hmac.compare_digest(expected, self.headers.get("x-closespan-signature", "")):
            self.send_error(401)
            return
        try:
            decoded = json.loads(body)
            if self.path == "/prompt-evaluations":
                job = validate_prompt_evaluation(decoded)
            elif self.path == "/prompt-evaluations/status":
                job = validate_prompt_evaluation_status(decoded)
            else:
                job = validate_job(decoded)
        except ValueError as error:
            self.send_json_error(400, str(error))
            return
        except json.JSONDecodeError:
            self.send_json_error(400, "Invalid Prompt Testing JSON request")
            return
        if self.path == "/prompt-evaluations/status":
            record = prompt_evaluation_status(job["requestId"], job["promptHash"])
            if record is None:
                self.send_error(404)
                return
            if record["status"] == "Complete":
                status = 200
                response = record["result"]
            elif record["status"] == "Failed":
                status = 502
                response = {"error": record.get("error", "PDD prompt evaluation failed")}
            else:
                status = 202
                response = {
                    "schemaVersion": 1,
                    "requestId": job["requestId"],
                    "promptHash": job["promptHash"],
                    "status": record["status"],
                }
            payload = json.dumps(response, separators=(",", ":")).encode()
            self.send_response(status)
            self.send_header("content-type", "application/json")
            self.send_header("content-length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
            return
        if not reserve_job():
            self.send_response(429)
            self.send_header("retry-after", "10")
            self.end_headers()
            return
        if self.path == "/prompt-evaluations":
            if not register_prompt_evaluation(job):
                cancel_reserved_job()
                self.send_response(409)
                self.end_headers()
                return
            try:
                threading.Thread(
                    target=execute_prompt_evaluation_reserved, args=(job,), daemon=True,
                ).start()
            except Exception:
                cancel_reserved_job()
                update_prompt_evaluation(
                    job["requestId"], status="Failed",
                    error="PDD prompt evaluation could not start",
                )
                raise
            payload = json.dumps({
                "schemaVersion": 1,
                "accepted": True,
                "requestId": job["requestId"],
                "promptHash": job["promptHash"],
                "status": "Queued",
            }, separators=(",", ":")).encode()
            self.send_response(202)
            self.send_header("content-type", "application/json")
            self.send_header("content-length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
            return
        try:
            threading.Thread(target=execute_reserved, args=(job,), daemon=True).start()
        except Exception:
            cancel_reserved_job()
            raise
        payload = json.dumps({"accepted": True, "verificationId": job["verificationId"]}).encode()
        self.send_response(202)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, format: str, *args: object) -> None:
        print(json.dumps({"event": "http", "message": format % args}))


if __name__ == "__main__":
    if not SHARED_SECRET or not CALLBACK_ORIGIN:
        raise SystemExit("PDD_RUNNER_SHARED_SECRET and CLOSESPAN_CALLBACK_ORIGIN are required")
    configure_cloud_credentials()
    PDD_CLI_VERSION = detect_pdd_cli_version()
    ThreadingHTTPServer(("0.0.0.0", int(os.getenv("PORT", "8080"))), Handler).serve_forever()
