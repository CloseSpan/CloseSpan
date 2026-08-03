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


def digest(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


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
        "pddVersion": job["pddVersion"],
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
            self.send_response(200 if SHARED_SECRET and CALLBACK_ORIGIN else 503)
            self.send_header("content-type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"status": "ok" if SHARED_SECRET and CALLBACK_ORIGIN else "not_configured"}).encode())
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
            job = json.loads(body)
            required = {"orgId", "verificationId", "promptHash", "pddPrompt", "pddVersion", "budgetUsd", "repositoryArchiveUrl", "permittedPaths", "requiredCommands", "callbackUrl"}
            if job.get("schemaVersion") != 1 or not required.issubset(job):
                raise ValueError("Invalid PDD job")
            safe_callback_url(job["callbackUrl"])
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
    ThreadingHTTPServer(("0.0.0.0", int(os.getenv("PORT", "8080"))), Handler).serve_forever()
