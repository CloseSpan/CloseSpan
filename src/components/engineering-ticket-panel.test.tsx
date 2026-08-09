import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { EngineeringWorkflowView } from "@/lib/engineering-workflow-repository";
import { EngineeringTicketPanel } from "./engineering-ticket-panel";

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
    run: null,
    releaseEvidence: null,
    ...overrides,
  };
}

describe("EngineeringTicketPanel prompt evaluation", () => {
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
});
