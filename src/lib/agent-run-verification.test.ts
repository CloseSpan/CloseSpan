import { describe, expect, it } from "vitest";
import { validateAgentImplementationReport } from "./agent-run-verification";
import type { ImplementationPromptSnapshot } from "./engineering-prompt";

const runId = "11111111-1111-4111-8111-111111111111";
const promptHash = "a".repeat(64);
const baseSha = "b".repeat(40);
const snapshot: ImplementationPromptSnapshot = {
  schemaVersion: 1,
  evidence: { problemId: "CS-1", title: "Bug", statement: "Broken", summary: "Broken", severity: "High", productArea: "Export", team: "Platform", assumptions: [], missingInformation: [], suspectedFiles: [], redactedEvidence: [] },
  ticket: {
    userStory: "As an analyst, I want exports to work so that I can report.", currentBehavior: "Broken", expectedBehavior: "Works", reproductionSteps: ["Export"], businessOutcome: "Reporting works",
    acceptanceCriteria: [{ id: "AC-1", statement: "The generated export contains all rows.", measurable: true }],
    testScenarios: [{ id: "TEST-1", title: "Export", given: "Rows", when: "Exported", then: "All present", testLevel: "integration", criterionIds: ["AC-1"] }],
    regressionScenarios: [], negativeScenarios: [], qualityExpectations: [], requiredTestLevels: ["integration"], releaseVerification: "Verify after release", nonGoals: [], permittedPaths: ["src/**", "tests/**"], requiredCommands: ["npm test"], repository: "owner/repo", baseBranch: "main", baseSha,
  },
};

function validReport() {
  return {
    schemaVersion: 1 as const, runId, promptHash, promptArtifactHash: promptHash,
    baseSha, status: "Tests passed" as const, summary: "Implemented",
    changedFiles: [{ path: "src/export.ts", contentBase64: Buffer.from("export const ok = true;\n").toString("base64"), reason: "Fix export" }],
    testFiles: ["src/export.ts"],
    tests: [{ command: "npm test", status: "passed" as const, output: "ok" }],
    criteria: [{ criterionId: "AC-1", status: "Passed" as const, evidence: "TEST-1 passed", scenarioIds: ["TEST-1"] }],
    remainingRisks: [], assumptions: [], manualVerification: [], logs: [],
  };
}

describe("agent implementation report verification", () => {
  it("accepts scoped changes with required tests and criterion evidence", () => {
    expect(validateAgentImplementationReport(validReport(), { runId, promptHash, baseSha, promptArtifactPath: ".prompt/tickets/CS-1.prompt.md", promptSnapshot: snapshot }).status).toBe("Tests passed");
  });

  it("rejects protected or out-of-scope paths", () => {
    const report = validReport();
    report.changedFiles[0]!.path = ".github/workflows/release.yml";
    expect(() => validateAgentImplementationReport(report, { runId, promptHash, baseSha, promptArtifactPath: ".prompt/tickets/CS-1.prompt.md", promptSnapshot: snapshot })).toThrow("protected path");
  });

  it("rejects successful reports with a missing required command", () => {
    const report = validReport();
    report.tests = [];
    expect(() => validateAgentImplementationReport(report, { runId, promptHash, baseSha, promptArtifactPath: ".prompt/tickets/CS-1.prompt.md", promptSnapshot: snapshot })).toThrow("Required command did not pass");
  });

  it("rejects high-confidence secrets in the final diff", () => {
    const report = validReport();
    report.changedFiles[0]!.contentBase64 = Buffer.from("OPENAI_API_KEY=sk-proj-abcdefghijklmnopqrstuvwxyz123456").toString("base64");
    expect(() => validateAgentImplementationReport(report, { runId, promptHash, baseSha, promptArtifactPath: ".prompt/tickets/CS-1.prompt.md", promptSnapshot: snapshot })).toThrow("Potential secret");
  });

  it("accepts stage-tagged setup evidence while preserving legacy interactions", () => {
    const report = {
      ...validReport(),
      runtimeEvidence: {
        configured: false,
        healthStatus: "not_configured" as const,
        applicationPort: null,
        previewUrl: null,
        interactions: [
          {
            stage: "verification" as const,
            tool: "setup" as const,
            target: "automatic setup",
            status: "passed",
            evidence: "Install and build completed.",
          },
          {
            tool: "logs" as const,
            target: "application log tail",
            status: "read",
            evidence: "Legacy evidence remains valid.",
          },
        ],
        logExcerpt: [],
        userStoryReplay: "not_required" as const,
      },
    };

    expect(validateAgentImplementationReport(report, {
      runId,
      promptHash,
      baseSha,
      promptArtifactPath: ".prompt/tickets/CS-1.prompt.md",
      promptSnapshot: snapshot,
    }).runtimeEvidence?.interactions).toHaveLength(2);
  });
});
