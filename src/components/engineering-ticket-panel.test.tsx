import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { EngineeringWorkflowView } from "@/lib/engineering-workflow-repository";
import {
  EngineeringTicketPanel,
  estimatedPddProgress,
  formatPddDuration,
  structurePddChange,
  structurePddChanges,
} from "./engineering-ticket-panel";

function workflow(
  overrides: Partial<EngineeringWorkflowView> = {},
): EngineeringWorkflowView {
  return {
    problemId: "prob_demo_export",
    specification: null,
    readiness: { ready: false, issues: ["Invalid input"] },
    prompt: null,
    verification: null,
    approval: null,
    finalApproval: null,
    run: null,
    releaseEvidence: null,
    ...overrides,
  };
}

describe("EngineeringTicketPanel prompt evaluation", () => {
  it("fills toward completion using the observed PDD duration without claiming completion early", () => {
    expect(estimatedPddProgress(0, 40_000)).toBe(4);
    expect(estimatedPddProgress(20_000, 40_000)).toBe(50);
    expect(estimatedPddProgress(40_000, 40_000)).toBe(95);
    expect(estimatedPddProgress(80_000, 40_000)).toBeLessThan(100);
    expect(formatPddDuration(45_000)).toBe("45 seconds");
    expect(formatPddDuration(75_000)).toBe("1m 15s");
  });

  it("turns a dense PDD recommendation into a readable summary and steps", () => {
    expect(structurePddChange(
      "Add a Contract section. Follow these specific instructions: 1. Add the requested outcome. 2. Include the boundary cases.",
    )).toEqual({
      summary: "Add a Contract section.",
      steps: ["Add the requested outcome.", "Include the boundary cases."],
    });
  });

  it("expands numbered recommendations embedded in one PDD change", () => {
    expect(structurePddChanges([
      '1. Retain the opening problem statement: Keep the first sentence: "Correct the export defect." 2. Insert the Contract: Add the requested outcome and acceptance criteria.',
    ])).toEqual([
      {
        summary: 'Retain the opening problem statement: Keep the first sentence: "Correct the export defect."',
        steps: [],
      },
      {
        summary: "Insert the Contract: Add the requested outcome and acceptance criteria.",
        steps: [],
      },
    ]);
  });

  it("requires a suggested prompt without presenting repository review first", () => {
    const markup = renderToStaticMarkup(
      <EngineeringTicketPanel
        orgId="org_demo"
        problemId="prob_demo_export"
        initialWorkflow={workflow()}
      />,
    );

    expect(markup).toContain("Suggested prompt required");
    expect(markup).toContain("No repository or Tenki VM runs here");
    expect(markup).not.toContain("Repository execution context");
    expect(markup).toMatch(/<button[^>]*disabled=""[^>]*>.*Suggested prompt required/s);
  });

  it("does not confuse incomplete ticket context with prompt evaluation", () => {
    const markup = renderToStaticMarkup(
      <EngineeringTicketPanel
        orgId="org_demo"
        problemId="prob_demo_export"
        initialWorkflow={workflow({
          specification: {
            userStory: "As an analyst, I want a complete export, so that I can finish reporting.",
            currentBehavior: "Large exports are empty.",
            expectedBehavior: "Large exports contain every row.",
            reproductionSteps: [],
            businessOutcome: "Reporting succeeds.",
            acceptanceCriteria: [],
            testScenarios: [],
            regressionScenarios: [],
            negativeScenarios: [],
            qualityExpectations: [],
            requiredTestLevels: [],
            releaseVerification: "Verify a synthetic export.",
            nonGoals: [],
            permittedPaths: [],
            requiredCommands: [],
            repository: "samshanmukh/closespan-agent-staging",
            baseBranch: "master",
            baseSha: "a".repeat(40),
          },
          readiness: {
            ready: false,
            issues: [
              "Add at least one reproduction step",
              "Add measurable acceptance criteria",
            ],
          },
        })}
      />,
    );

    expect(markup).toContain("Suggested prompt required");
    expect(markup).not.toContain("Complete the engineering ticket");
    expect(markup).not.toContain("Repository execution context");
  });

  it("identifies the exact agent prompt that will be tested", () => {
    const markup = renderToStaticMarkup(
      <EngineeringTicketPanel
        orgId="org_demo"
        problemId="prob_demo_export"
        initialWorkflow={workflow({
          prompt: {
            id: "prompt_1",
            revision: 2,
            status: "Draft",
            artifactPath: ".prompt/tickets/export.prompt.md",
            content: "# Correct large exports\n\nReturn every requested row.",
            contentHash: "a".repeat(64),
            repository: "samshanmukh/closespan-agent-staging",
            baseBranch: "master",
            baseSha: "b".repeat(40),
            createdAt: "2026-08-09T00:00:00.000Z",
          },
        })}
      />,
    );

    expect(markup).toContain("Agent-written prompt");
    expect(markup).toContain("Revision 2");
    expect(markup).toContain("View prompt under test");
    expect(markup).toContain("This is the exact prompt PDD will compare");
  });
});
