"""Small signed adapter around PDD local mode.

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
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


MAX_JOB_BYTES = 1_000_000
MAX_ARCHIVE_BYTES = 50_000_000
MAX_OUTPUT_BYTES = 750_000
RUN_TIMEOUT_SECONDS = 240
RUN_SLOTS = threading.BoundedSemaphore(int(os.getenv("PDD_RUNNER_CONCURRENCY", "2")))
SHARED_SECRET = os.environ.get("PDD_RUNNER_SHARED_SECRET", "").encode()
PDD_MODEL = os.environ.get("PDD_MODEL", "").strip()
CALLBACK_ORIGIN = os.environ.get("CLOSESPAN_CALLBACK_ORIGIN", "").strip().rstrip("/")
PDD_CLI_VERSION: str | None = None
PDD_VERSION_TOKEN = re.compile(
    r"(?<![0-9A-Za-z.])v?(\d{1,4}\.\d{1,4}\.\d{1,4})(?![0-9A-Za-z.])"
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
            timeout=10, check=False,
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
    configured = bool(SHARED_SECRET and CALLBACK_ORIGIN and PDD_CLI_VERSION)
    return {
        "status": "ok" if configured else "not_configured",
        "pddVersion": PDD_CLI_VERSION,
        "executionProfileSchemaVersions": [1, 2],
    }


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
    if schema_version == 2:
        validate_runtime_v2_config(config, command_groups)

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
    raise ValueError(f"PDD runner does not support the target extension {suffix}")


def choose_target(root: pathlib.Path, suspected: list[str]) -> tuple[pathlib.Path, str, pathlib.Path]:
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
        output = relative.parent / output_name
        return target, language, pathlib.Path(str(output))
    raise ValueError("No supported suspected source file exists in the repository snapshot")


def permitted(path: str, patterns: list[str]) -> bool:
    return any(fnmatch.fnmatchcase(path, pattern) for pattern in patterns)


def cost_report(path: pathlib.Path) -> tuple[float | None, str | None]:
    if not path.exists():
        return None, PDD_MODEL or None
    total = 0.0
    model = PDD_MODEL or None
    with path.open(newline="", encoding="utf-8") as handle:
        for row in csv.DictReader(handle):
            try:
                total += float(row.get("cost") or 0)
            except ValueError:
                pass
            model = row.get("resolved_model") or row.get("model") or model
    return round(total, 6), model


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
        with RUN_SLOTS, tempfile.TemporaryDirectory(prefix="closespan-pdd-") as temporary:
            root = pathlib.Path(temporary)
            extract_archive(download_archive(job["repositoryArchiveUrl"]), root)
            target, language, output = choose_target(root, job.get("suspectedFiles", []))
            relative_target = target.relative_to(root)
            output_text = output.as_posix()
            if not permitted(output_text, job["permittedPaths"]):
                raise ValueError(f"Derived PDD test path is not permitted: {output_text}")
            command = next((item for item in job["requiredCommands"] if "test" in item.lower()), None)
            if not command:
                raise ValueError("The ticket has no approved test command")
            prompt = root / f"closespan_{language}.prompt"
            prompt.write_text(job["pddPrompt"], encoding="utf-8")
            (root / output).parent.mkdir(parents=True, exist_ok=True)
            costs = root / "pdd-costs.csv"
            environment = os.environ.copy()
            environment["PDD_CLOUD_RUN"] = "false"
            environment["PDD_FORCE_LOCAL"] = "1"
            if PDD_MODEL:
                environment["PDD_MODEL_DEFAULT"] = PDD_MODEL
            process = subprocess.run(
                [
                    "pdd", "--local", "--force", "--quiet", "--no-core-dump",
                    "--output-cost", str(costs), "test", "--manual",
                    "--language", language, "--output", output_text,
                    prompt.name, relative_target.as_posix(),
                ],
                cwd=root, env=environment, capture_output=True, text=True,
                timeout=RUN_TIMEOUT_SECONDS, check=False,
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
            if cost is not None and cost > float(job["budgetUsd"]):
                raise RuntimeError(f"PDD cost ${cost:.4f} exceeded the configured ${float(job['budgetUsd']):.4f} review budget")
            result.update({
                "status": "Ready for approval",
                "model": model,
                "costUsd": cost,
                "summary": "PDD generated one immutable repository-native acceptance test from the PM user story.",
                "generatedTests": [{
                    "path": output_text, "content": content,
                    "contentHash": digest(content), "command": command,
                }],
                "failureMessage": None,
            })
    except Exception as error:  # The signed callback carries a bounded safe message.
        result["failureMessage"] = str(error)[:5_000]
    callback(job, result)


class Handler(BaseHTTPRequestHandler):
    server_version = "CloseSpanPDD/1"

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
        if self.path != "/verifications" or not SHARED_SECRET:
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
            job = validate_job(json.loads(body))
        except (ValueError, json.JSONDecodeError):
            self.send_error(400)
            return
        threading.Thread(target=execute, args=(job,), daemon=True).start()
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
    PDD_CLI_VERSION = detect_pdd_cli_version()
    ThreadingHTTPServer(("0.0.0.0", int(os.getenv("PORT", "8080"))), Handler).serve_forever()
