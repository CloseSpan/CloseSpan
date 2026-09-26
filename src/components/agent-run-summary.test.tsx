import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { AgentRunView } from "@/lib/engineering-workflow-repository";
import { AgentRunSummary, type AgentRunSummaryProps } from "./agent-run-summary";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

const runId = "0305a175-a11e-4dbc-8616-dbe0ad022978";
const approvalId = "e8ecb42b-7eae-4a94-aa87-bc4c2b966698";
const problemId = "problem-caption-undo";

function run(overrides: Partial<AgentRunView> = {}): AgentRunView {
  return {
    id: runId,
    approvalId,
    repository: "example/product",
    baseBranch: "main",
    baseSha: "a".repeat(40),
    status: "Draft PR opened",
    branchName: "closespan/problem-caption-undo-long-generated-branch",
    changedFiles: ["src/captions.ts"],
    testFiles: ["test/captions.test.ts"],
    testResults: [{ command: "npm run test:captions", status: "passed", output: "Raw test output" }],
    criterionResults: [{
      criterionId: "AC-1", status: "Passed", statement: "Already verified acceptance detail",
      evidence: "Raw acceptance evidence", scenarioIds: ["TEST-1"],
    }],
    failureCode: null,
    failureMessage: null,
    pullRequestUrl: "https://github.com/example/product/pull/8",
    queuedAt: "2026-09-06T10:00:00Z",
    completedAt: "2026-09-06T10:02:00Z",
    implementationSummary: "Long implementation narrative",
    remainingRisks: [],
    manualVerification: [],
    logs: ["Raw executor logs"],
    independentVerification: {
      provider: "Tenki Sandbox", sessionId: "private-session-id", status: "passed",
      completedAt: "2026-09-06T10:02:00Z", durationMs: 1200,
    },
    ...overrides,
  };
}

function render(item = run(), overrides: Partial<AgentRunSummaryProps> = {}) {
  return renderToStaticMarkup(<AgentRunSummary
    run={item} problemId={problemId} title="Undo regenerated captions" isAdmin={false}
    {...overrides}
  />);
}

function resultValue(html: string, label: string): string | undefined {
  return html.match(new RegExp(`<dt>${label}</dt><dd><span[^>]*>([^<]+)</span></dd>`))?.[1];
}

function runtime(overrides: Partial<NonNullable<AgentRunView["runtimeEvidence"]>> = {}): NonNullable<AgentRunView["runtimeEvidence"]> {
  return {
    configured: true, healthStatus: "passed", applicationPort: 3000, previewUrl: null,
    interactions: [], logExcerpt: [], userStoryReplay: "passed", userStoryReplayMode: "live_application",
    ...overrides,
  };
}

describe("focused agent run summary", () => {
  it("keeps presentation runs read-only and omits retry and external navigation", () => {
    const html = render(run({ status: "Failed", failureCode: "sandbox_unavailable", runtimeEvidence: runtime({ previewUrl: "https://preview.example.test" }) }), { isAdmin: true, presentationDemo: true });
    expect(html).toContain("Demo · sample data");
    expect(html).toContain("Read-only results");
    expect(html).not.toContain("Retry coding run");
    expect(html).not.toContain("Technical details");
    expect(html).not.toContain("https://github.com");
    expect(html).not.toContain("https://preview.example.test");
  });
  it("shows the problem, outcomes, and actions without technical or repeated narrative", () => {
    const html = render();
    const visibleText = html.replace(/<[^>]*>/g, "");

    expect(html).toContain("Undo regenerated captions");
    expect(html).toContain("example/product");
    expect(resultValue(html, "Automated tests")).toBe("1 passed");
    expect(resultValue(html, "Acceptance checks")).toBe("1 of 1 passed");
    expect(html).toContain(`href="/problems/${problemId}"`);
    expect(html).toContain(`href="/approvals?approval=${approvalId}"`);
    expect(html).toContain(`href="/agent-runs/${runId}/details"`);
    expect(html).toContain("Technical details");
    expect(html).toContain('href="https://github.com/example/product/pull/8"');
    expect(html).not.toContain("<details");
    expect(html).not.toContain("Needs attention");
    for (const value of [runId, approvalId, run().branchName, run().baseSha!, "npm run test:captions",
      "Raw test output", "Raw executor logs", "Already verified acceptance detail", "Raw acceptance evidence",
      "Long implementation narrative", "private-session-id", "src/captions.ts", "TEST-1"]) {
      expect(visibleText).not.toContain(value);
    }
  });

  it("does not let a successful implementation narrative hide a failure", () => {
    const html = render(run({ status: "Failed", failureMessage: "Independent verification failed.",
      implementationSummary: "Everything passed in the implementation runner." }));
    expect(html).toContain('role="alert">Independent verification failed.');
    expect(html).toContain("Needs attention");
    expect(html).not.toContain("Everything passed in the implementation runner.");
  });

  it.each([
    ["Queued", "Pending"], ["Running", "Pending"], ["Tests passed", "Running"],
    ["Failed", "Not run"], ["Cancelled", "Not run"], ["No changes", "Not run"],
  ] as const)("keeps independent verification truthful for a %s run", (status, expected) => {
    expect(resultValue(render(run({ status, independentVerification: undefined })), "Independent verification")).toBe(expected);
  });

  it("distinguishes independently verified commands from an untested live application", () => {
    const html = render();
    expect(resultValue(html, "Independent verification")).toBe("Verified");
    expect(resultValue(html, "Live app test")).toBe("Not configured");
  });

  it("shows a failed independent verification even after implementation tests passed", () => {
    const independentVerification = run().independentVerification!;
    const html = render(run({ independentVerification: { ...independentVerification, status: "failed" } }));
    expect(resultValue(html, "Independent verification")).toBe("Failed");
    expect(resultValue(html, "Automated tests")).toBe("1 passed");
  });

  it.each([
    ["contract", "Prompt contract test"], ["live_application", "Live app test"],
  ] as const)("labels a passed %s replay by the kind of evidence it provides", (mode, label) => {
    const html = render(run({ runtimeEvidence: runtime({ userStoryReplayMode: mode }) }));
    expect(resultValue(html, label)).toBe("Passed");
    expect(resultValue(html, "Application health")).toBe("Healthy");
    if (mode === "contract") expect(html).not.toContain("Live app test");
  });

  it("does not equate healthy runtime with a tested user scenario", () => {
    const html = render(run({ runtimeEvidence: runtime({ userStoryReplay: "not_required", userStoryReplayMode: "not_required" }) }));
    expect(resultValue(html, "Application health")).toBe("Healthy");
    expect(resultValue(html, "Scenario test")).toBe("Not run");
  });

  it("preserves a failed live app test independently of healthy runtime", () => {
    const html = render(run({ runtimeEvidence: runtime({ userStoryReplay: "failed" }) }));
    expect(resultValue(html, "Application health")).toBe("Healthy");
    expect(resultValue(html, "Live app test")).toBe("Failed");
  });

  it("keeps failed and skipped tests, unresolved acceptance, and manual risks visible", () => {
    const html = render(run({
      testResults: [
        { command: "pass-command", status: "passed", output: "" },
        { command: "fail-command", status: "failed", output: "" },
        { command: "skip-command", status: "skipped", output: "" },
      ],
      criterionResults: [
        ...run().criterionResults,
        { criterionId: "AC-2", status: "Failed", statement: "Undo did not restore the caption.", evidence: "", scenarioIds: [] },
        { criterionId: "AC-3", status: "Pending manual", statement: "Check accessibility with VoiceOver.", evidence: "", scenarioIds: [] },
        { criterionId: "AC-4", status: "Not verified", evidence: "Mobile browser coverage is missing.", scenarioIds: [] },
      ],
      remainingRisks: ["Older captions may not include undo history."],
      manualVerification: ["Try the undo flow on a physical device."],
    }));
    expect(resultValue(html, "Automated tests")).toBe("1 passed · 1 failed · 1 skipped");
    expect(resultValue(html, "Acceptance checks")).toBe("1 of 4 passed");
    for (const text of ["Needs attention", "Pending manual", "Not verified", "Undo did not restore the caption.",
      "Check accessibility with VoiceOver.", "Mobile browser coverage is missing.",
      "Older captions may not include undo history.", "Try the undo flow on a physical device."]) expect(html).toContain(text);
    expect(html).not.toContain("Already verified acceptance detail");
  });

  it("does not show empty tests or acceptance as passing", () => {
    const html = render(run({ testResults: [], criterionResults: [] }));
    expect(resultValue(html, "Automated tests")).toBe("Not run");
    expect(resultValue(html, "Acceptance checks")).toBe("Not run");
  });

  it("shows the latest merge result instead of stale draft status", () => {
    const html = render(run(), { finalExecutionStatus: "Succeeded" });
    expect(html).toContain("PR merged");
    expect(html).toContain("Open pull request");
    expect(html).not.toContain("Draft PR opened");
    expect(html).not.toContain("Open draft PR");
  });

  it("keeps a merge failure actionable", () => {
    const html = render(run(), { finalExecutionStatus: "Failed" });
    expect(html).toContain("Merge failed.");
    expect(html).toContain('href="/approvals"');
    expect(html).toContain("Review approvals");
  });

  it.each(["Failed", "No changes"] as const)("offers an Admin an explicit one-run retry for %s", (status) => {
    const html = render(run({ status, pullRequestUrl: null }), { isAdmin: true });
    expect(html).toContain("Retry one coding run");
    expect(html).toContain("Starts one new coding run with the same approved prompt and commit.");
  });

  it("does not offer retries to members or for stale approvals, existing PRs, or active runs", () => {
    const failed = run({ status: "Failed", pullRequestUrl: null });
    const blocked = [
      render(failed),
      render(run({ ...failed, failureCode: "stale_base" }), { isAdmin: true }),
      render(run({ ...failed, failureMessage: "stale_base: branch moved" }), { isAdmin: true }),
      render(run({ ...failed, pullRequestUrl: "https://github.com/example/product/pull/8" }), { isAdmin: true }),
      render(run({ status: "Running", pullRequestUrl: null }), { isAdmin: true }),
      render(run({ status: "Cancelled", pullRequestUrl: null }), { isAdmin: true }),
    ];
    for (const html of blocked) expect(html).not.toContain("Retry one coding run");
    expect(blocked[1]).toContain("The repository changed after approval.");
  });

  it("labels a preview as temporary instead of implying persistent availability", () => {
    const html = render(run({ runtimeEvidence: runtime({ previewUrl: "https://preview.example.com/temporary" }) }));
    expect(html).toContain('href="https://preview.example.com/temporary"');
    expect(html).toContain("Temporary preview (may expire)");
  });
});
