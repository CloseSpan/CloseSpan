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
import uuid
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

PROFILE_CONFIG_KEYS = {
    "schemaVersion", "language", "framework", "packageManager", "runtimeVersion",
    "workingDirectory", "installCommands", "buildCommands", "testCommands",
    "typecheckCommands", "permittedPaths", "tenkiImage", "tenkiSnapshotId",
    "cpuCores", "memoryMb", "allowInbound", "allowOutbound", "maxDurationMs",
    "idleTimeoutMinutes",
}
PROFILE_SNAPSHOT_KEYS = {
    "profileId", "version", "source", "repository", "workspaceRoot",
    "contentHash", "config",
}
PROFILE_SOURCES = {"confirmed", "override", "safe_generic"}


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


def validate_execution_profile(job: dict) -> dict:
    profile_id = job.get("executionProfileId")
    profile_hash = job.get("executionProfileHash")
    snapshot = job.get("executionProfileSnapshot")
    if not isinstance(profile_id, str) or not isinstance(profile_hash, str):
        raise ValueError("PDD job is missing its execution profile binding")
    try:
        uuid.UUID(profile_id)
    except (ValueError, AttributeError):
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
        repository and len(repository.split("/")) != 2
    ):
        raise ValueError("PDD execution profile repository is invalid")
    if repository and repository != job.get("repository"):
        raise ValueError("PDD execution profile belongs to another repository")
    workspace_root = safe_relative_path(snapshot.get("workspaceRoot"), "Workspace root")
    if not repository and workspace_root != ".":
        raise ValueError("A workspace execution profile must use the repository root")

    config = snapshot.get("config")
    if not isinstance(config, dict) or set(config) != PROFILE_CONFIG_KEYS:
        raise ValueError("PDD execution profile configuration is invalid")
    if config.get("schemaVersion") != 1:
        raise ValueError("PDD execution profile configuration version is invalid")
    for label in ("language", "packageManager"):
        value = config.get(label)
        if not isinstance(value, str) or not value.strip() or len(value) > 80:
            raise ValueError(f"PDD execution profile {label} is invalid")
    for label in ("framework", "runtimeVersion", "tenkiImage", "tenkiSnapshotId"):
        value = config.get(label)
        if value is not None and (not isinstance(value, str) or not value.strip() or len(value) > 500):
            raise ValueError(f"PDD execution profile {label} is invalid")
    if config.get("tenkiImage") and config.get("tenkiSnapshotId"):
        raise ValueError("PDD execution profile cannot use an image and snapshot together")
    working_directory = safe_relative_path(config.get("workingDirectory"), "Working directory")
    if not repository and working_directory != ".":
        raise ValueError("A workspace execution profile must run from the repository root")
    if workspace_root != "." and not (
        working_directory == workspace_root or working_directory.startswith(f"{workspace_root}/")
    ):
        raise ValueError("PDD execution profile working directory is outside its monorepo root")

    commands: list[str] = []
    for key in ("installCommands", "buildCommands", "testCommands", "typecheckCommands"):
        commands.extend(string_list(config.get(key), key, 30))
    profile_paths = [safe_relative_path(path, "Profile permitted path") for path in string_list(config.get("permittedPaths"), "permittedPaths", 100)]
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
    if not isinstance(job["repository"], str) or len(job["repository"].split("/")) != 2:
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
