import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { issueRuntimeVerificationReportSchema } from "./issue-runtime-verification";

const workflow = readFileSync(
  resolve(process.cwd(), "templates/tenki-github-actions/closespan-runtime-verifier.yml"),
  "utf8",
);

describe("current-issue runtime verifier workflow template", () => {
  it("gives every dispatch a webhook-reconcilable run name", () => {
    expect(workflow).toContain("run-name: CloseSpan verification ${{ inputs.closespan_run_id }}");
  });

  it("boots and exports a reusable iOS Simulator harness before verification", () => {
    expect(workflow).toContain("name: Prepare iOS Simulator harness");
    expect(workflow).toContain("xcrun simctl bootstatus");
    expect(workflow).toContain("CLOSESPAN_IOS_SIMULATOR_UDID");
    expect(workflow).toContain(".closespan-run/bin/ios-simulator");
    expect(workflow).toContain('sips --resampleHeightWidthMax 960 "$output"');
  });

  it("allows CoreSimulator access only for the macOS verifier job", () => {
    expect(workflow).toContain("sandbox: ${{ runner.os == 'macOS' && 'danger-full-access' || 'workspace-write' }}");
    expect(workflow).toContain("safety-strategy: drop-sudo");
    expect(workflow).toContain("persist-credentials: false");
    expect(workflow).toContain("contents: read");
  });

  it("reports bootstrap failures even when no verification artifact directory exists", () => {
    expect(workflow).toContain("needs: [bootstrap, verify]");
    expect(workflow).toContain("mkdir -p .closespan-run");
    expect(workflow).toContain("The verifier could not fetch its approval-bound CloseSpan job.");
  });

  it("creates a valid provisional report before the model begins runtime work", () => {
    const provisionalReport = workflow.indexOf(
      'fs.writeFileSync(".closespan-run/runtime-verification.json"',
    );
    const modelStep = workflow.indexOf("name: Run current-issue verifier");

    expect(provisionalReport).toBeGreaterThan(-1);
    expect(modelStep).toBeGreaterThan(provisionalReport);
    expect(workflow).toContain("A provisional report was created before runtime execution");
  });

  it("normalizes an incomplete model report into an attested blocked result", () => {
    const step = workflow.slice(workflow.indexOf("- name: Validate and attest verification report"));
    const scriptStart = step.indexOf("node <<'NODE'\n") + "node <<'NODE'\n".length;
    const scriptEnd = step.indexOf("\n          NODE", scriptStart);
    const script = step.slice(scriptStart, scriptEnd).replace(/^ {10}/gm, "");
    const workingDirectory = mkdtempSync(resolve(tmpdir(), "closespan-verifier-"));
    mkdirSync(resolve(workingDirectory, ".closespan-run"));
    execFileSync("git", ["init", "--quiet"], { cwd: workingDirectory });
    const runId = "11111111-1111-4111-8111-111111111111";
    const baseSha = "a".repeat(40);
    writeFileSync(
      resolve(workingDirectory, ".closespan-run/closespan-runtime-job.json"),
      JSON.stringify({ runId, baseSha }),
    );
    writeFileSync(
      resolve(workingDirectory, ".closespan-run/runtime-verification.json"),
      JSON.stringify({
        schemaVersion: 1,
        runId,
        baseSha,
        outcome: "Verification blocked",
        summary: "Runtime verification is still in progress and has no final result.",
        expectedBehavior: "The menu presents the requested actions.",
        actualBehavior: "Pending simulator execution.",
        reproductionSteps: [],
        commands: [{ command: "xcodebuild", status: "passed", output: "Build succeeded", durationMs: 1000 }],
        observations: ["Source inspection completed."],
        artifacts: [],
      }),
    );

    execFileSync(process.execPath, ["-e", script], {
      cwd: workingDirectory,
      env: {
        ...process.env,
        CODEX_OUTCOME: "success",
        RUNNER_LABEL: "tenki-macos-xcode-26",
        GITHUB_RUN_ID: "12345",
      },
    });

    const report = JSON.parse(readFileSync(
      resolve(workingDirectory, ".closespan-run/runtime-verification.json"),
      "utf8",
    ));
    expect(report).toMatchObject({
      schemaVersion: 1,
      runId,
      baseSha,
      outcome: "Verification blocked",
      summary: expect.stringContaining("incomplete report"),
      reproductionSteps: ["Attempted the repository-scoped runtime verification plan."],
      environment: {
        runnerLabel: "tenki-macos-xcode-26",
        workflowRunId: 12345,
      },
    });
    expect(report.commands).toHaveLength(1);
    expect(report.observations).toContainEqual(expect.stringContaining("reproduction steps were missing"));
    expect(issueRuntimeVerificationReportSchema.safeParse(report).success).toBe(true);
  });
});
