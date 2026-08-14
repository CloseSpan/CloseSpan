import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { EngineeringWorkflowView } from "@/lib/engineering-workflow-repository";
import {
  EngineeringTicketPanel,
  engineeringPreparationSteps,
  estimatedPddProgress,
  formatPddDuration,
  pddRecommendationIsComplete,
  pddSuggestedRevisionDiffers,
  shouldAutomaticallyPreparePrompt,
  shouldOfferManualPromptRevision,
  structurePddChange,
  structurePddChanges,
} from "./engineering-ticket-panel";
import { BackgroundPromptTestProvider } from "./background-prompt-tests";

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

function renderPanel(
  initialWorkflow: EngineeringWorkflowView,
  initialRepositoryProfileReady = true,
): string {
  return renderToStaticMarkup(
    <BackgroundPromptTestProvider orgId="org_demo">
      <EngineeringTicketPanel
        orgId="org_demo"
        problemId="prob_demo_export"
        initialWorkflow={initialWorkflow}
        autonomyLevel="Execute with approval"
        initialRepositoryProfileReady={initialRepositoryProfileReady}
      />
    </BackgroundPromptTestProvider>,
  );
}

describe("EngineeringTicketPanel prompt evaluation", () => {
  const readyPromptWorkflow = () => workflow({
    specification: {
      id: "spec_1",
      revision: 1,
      userStory: "As a user, I want the input to work, so that I can finish.",
      currentBehavior: "The input fails.",
      expectedBehavior: "The input works.",
      reproductionSteps: ["Submit the input."],
      businessOutcome: "The workflow completes.",
      acceptanceCriteria: [{ id: "AC-1", statement: "The workflow completes.", measurable: true }],
      testScenarios: [],
      regressionScenarios: [],
      negativeScenarios: [],
      qualityExpectations: [],
      requiredTestLevels: ["integration"],
      releaseVerification: "Verify the workflow.",
      nonGoals: [],
      permittedPaths: ["src/**"],
      requiredCommands: ["npm test"],
      repository: "closespan/app",
      baseBranch: "main",
      baseSha: "a".repeat(40),
    },
    readiness: { ready: true, issues: [] },
    prompt: {
      id: "prompt_1",
      revision: 1,
      status: "Ready",
      artifactPath: "tickets/prompt.md",
      content: "Fix the input.",
      contentHash: "b".repeat(64),
      repository: "closespan/app",
      baseBranch: "main",
      baseSha: "a".repeat(40),
      createdAt: "2026-08-11T12:00:00.000Z",
    },
  });

  it("keeps preparation checkpoints sequential even when later data already exists", () => {
    expect(engineeringPreparationSteps({
      repositoryProfileReady: false,
      promptReady: true,
      promptAligned: true,
      acceptanceReady: false,
      approvalReady: false,
    }).map((step) => step.state)).toEqual([
      "current",
      "upcoming",
      "upcoming",
      "upcoming",
      "upcoming",
      "upcoming",
    ]);

    expect(engineeringPreparationSteps({
      repositoryProfileReady: true,
      promptReady: true,
      promptAligned: true,
      acceptanceReady: true,
      approvalReady: true,
    }).every((step) => step.state === "complete")).toBe(true);
  });

  it("does not repeat the Prompt Testing preparation tracker inside the focused prompt panel", () => {
    const markup = renderPanel(readyPromptWorkflow());

    expect(markup).not.toContain("Prepare this task for action");
    expect(markup).not.toContain("3 of 6 complete");
    expect(markup).not.toContain('aria-current="step"');
    expect(markup).toContain("Agent-written prompt");
  });

  it("puts repository review first when this ticket has no confirmed active profile", () => {
    const markup = renderPanel(readyPromptWorkflow(), false);

    expect(markup).not.toContain("0 of 6 complete");
    expect(markup).not.toContain("Prepare this task for action");
    expect(markup).toContain("Confirm the repository execution context");
  });

  it("starts automatic Prompt Testing only for an eligible autonomy level and only once", () => {
    const candidate = readyPromptWorkflow();
    expect(shouldAutomaticallyPreparePrompt({
      autonomyLevel: "Execute with approval",
      workflow: candidate,
      userStory: candidate.specification!.userStory,
      ticketContextMissing: false,
      hasBackgroundTask: false,
    })).toBe(true);
    expect(shouldAutomaticallyPreparePrompt({
      autonomyLevel: "Observe",
      workflow: candidate,
      userStory: candidate.specification!.userStory,
      ticketContextMissing: false,
      hasBackgroundTask: false,
    })).toBe(false);
    expect(shouldAutomaticallyPreparePrompt({
      autonomyLevel: "Execute with approval",
      workflow: {
        ...candidate,
        promptEvaluation: {
          id: "evaluation_1",
          triggerSource: "automatic",
          status: "Succeeded",
          promptRevisionId: "prompt_1",
          promptHash: "b".repeat(64),
          userStory: candidate.specification!.userStory,
          review: null,
          failureMessage: null,
          acceptancePreparationFailureMessage: null,
          appliedPromptRevisionId: null,
          applied: false,
          automaticAttempted: true,
          createdAt: "2026-08-11T12:00:00.000Z",
          completedAt: "2026-08-11T12:01:00.000Z",
        },
      },
      userStory: candidate.specification!.userStory,
      ticketContextMissing: false,
      hasBackgroundTask: false,
    })).toBe(false);
  });

  it("offers Apply only for a live manual evaluation of the current immutable prompt", () => {
    const valid = {
      triggerSource: "manual" as const,
      verdict: "Needs revision" as const,
      currentPromptHash: "a".repeat(64),
      evaluatedPromptHash: "a".repeat(64),
      suggestedRevision: "Improved prompt",
      revisionReceipt: "signed.receipt",
    };
    expect(shouldOfferManualPromptRevision(valid)).toBe(true);
    expect(shouldOfferManualPromptRevision({
      ...valid,
      currentPromptHash: "b".repeat(64),
    })).toBe(false);
    expect(shouldOfferManualPromptRevision({
      ...valid,
      triggerSource: "automatic",
    })).toBe(false);
  });

  it("does not offer a no-op prompt revision as an improvement", () => {
    expect(pddSuggestedRevisionDiffers(
      "Fix the input.",
      "Fix the input.",
    )).toBe(false);
    expect(pddSuggestedRevisionDiffers(
      "Fix the input.",
      "Fix the input and preserve the existing workflow.",
    )).toBe(true);
  });

  it("places the tested and proposed prompts side by side before the user story", () => {
    const candidate = readyPromptWorkflow();
    const markup = renderPanel({
      ...candidate,
      promptEvaluation: {
        id: "evaluation_1",
        triggerSource: "manual",
        status: "Succeeded",
        promptRevisionId: "prompt_1",
        promptHash: "b".repeat(64),
        userStory: candidate.specification!.userStory,
        review: {
          verdict: "Needs revision",
          summary: "Clarify the expected behavior before approval.",
          changes: ["Preserve the existing workflow while correcting the input."],
          suggestedRevision: "Fix the input and preserve the existing workflow.",
          pddVersion: "0.0.309",
          executionMode: "local",
          model: null,
          costUsd: 0.01,
          promptHash: "b".repeat(64),
          alignmentReceipt: null,
          revisionReceipt: null,
        },
        failureMessage: null,
        acceptancePreparationFailureMessage: null,
        appliedPromptRevisionId: null,
        applied: false,
        automaticAttempted: false,
        createdAt: "2026-08-11T12:00:00.000Z",
        completedAt: "2026-08-11T12:01:00.000Z",
      },
    });

    expect(markup).toContain("Review the proposed prompt");
    expect(markup).toContain("Tested prompt");
    expect(markup).toContain("Proposed prompt");
    expect(markup).toContain("Fix the input.");
    expect(markup).toContain("Fix the input and preserve the existing workflow.");
    expect(markup.indexOf("Review the proposed prompt")).toBeLessThan(
      markup.indexOf("User story"),
    );
    expect(markup).not.toContain("Test again");
  });

  it("shows a durable automatic result as review-ready instead of restarting it", () => {
    const candidate = readyPromptWorkflow();
    const markup = renderPanel({
      ...candidate,
      promptEvaluation: {
        id: "evaluation_1",
        triggerSource: "automatic",
        status: "Succeeded",
        promptRevisionId: "prompt_1",
        promptHash: "b".repeat(64),
        userStory: candidate.specification!.userStory,
        review: null,
        failureMessage: null,
        acceptancePreparationFailureMessage: null,
        appliedPromptRevisionId: null,
        applied: false,
        automaticAttempted: true,
        createdAt: "2026-08-11T12:00:00.000Z",
        completedAt: "2026-08-11T12:01:00.000Z",
      },
    });
    expect(markup).toContain("Automatic prompt test complete");
    expect(markup).toContain("existing revision is marked complete");
    expect(markup).toContain("Run prompt test");
    expect(markup).not.toContain("Preparing agent approval");
  });

  it("fills toward completion using the observed Prompt Testing duration without claiming completion early", () => {
    expect(estimatedPddProgress(0, 40_000)).toBe(4);
    expect(estimatedPddProgress(20_000, 40_000)).toBe(50);
    expect(estimatedPddProgress(40_000, 40_000)).toBe(95);
    expect(estimatedPddProgress(80_000, 40_000)).toBeLessThan(100);
    expect(formatPddDuration(45_000)).toBe("45 seconds");
    expect(formatPddDuration(75_000)).toBe("1m 15s");
  });

  it("shimmers the Prompt Testing button label only while testing is in progress", () => {
    const candidate = readyPromptWorkflow();
    const markup = renderPanel({
      ...candidate,
      promptEvaluation: {
        id: "evaluation_1",
        triggerSource: "manual",
        status: "Running",
        promptRevisionId: "prompt_1",
        promptHash: "b".repeat(64),
        userStory: candidate.specification!.userStory,
        review: null,
        failureMessage: null,
        acceptancePreparationFailureMessage: null,
        appliedPromptRevisionId: null,
        applied: false,
        automaticAttempted: false,
        createdAt: "2026-08-11T12:00:00.000Z",
        completedAt: null,
      },
    });

    expect(markup).toContain('<span class="pdd-testing-shimmer-text">Testing prompt</span>');
  });

  it("keeps the execution-profile blocker visible beside a passed alignment result", () => {
    const candidate = readyPromptWorkflow();
    const blocker = "Confirm this ticket's repository and an active execution profile before Prompt Testing.";
    const markup = renderPanel({
      ...candidate,
      promptEvaluation: {
        id: "evaluation_1",
        triggerSource: "manual",
        status: "Succeeded",
        promptRevisionId: "prompt_1",
        promptHash: "b".repeat(64),
        userStory: candidate.specification!.userStory,
        review: {
          verdict: "Passed",
          summary: "The prompt and user story are aligned.",
          changes: [],
          suggestedRevision: null,
          pddVersion: "0.0.309",
          executionMode: "local",
          model: null,
          costUsd: 0,
          promptHash: "b".repeat(64),
          alignmentReceipt: null,
          revisionReceipt: null,
        },
        failureMessage: null,
        acceptancePreparationFailureMessage: blocker,
        appliedPromptRevisionId: null,
        applied: false,
        automaticAttempted: false,
        createdAt: "2026-08-11T12:00:00.000Z",
        completedAt: "2026-08-11T12:01:00.000Z",
      },
    });

    expect(markup).toContain("Prompt alignment passed");
    expect(markup).not.toContain("Prompt Testing passed");
    expect(markup).toContain("Execution setup blocked");
    expect(markup).toContain(blocker.replaceAll("'", "&#x27;"));
    expect(markup).toContain("Confirm the repository execution context");
  });

  it("turns a dense Prompt Testing recommendation into a readable summary and steps", () => {
    expect(structurePddChange(
      "Add a Contract section. Follow these specific instructions: 1. Add the requested outcome. 2. Include the boundary cases.",
    )).toEqual({
      summary: "Add a Contract section.",
      steps: ["Add the requested outcome.", "Include the boundary cases."],
    });
  });

  it("expands numbered recommendations embedded in one Prompt Testing change", () => {
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

  it("detects a detector response that ends mid-sentence", () => {
    expect(pddRecommendationIsComplete(
      'Insert the generated contract sections, including "Negative Cases" (the bullet',
    )).toBe(false);
    expect(pddRecommendationIsComplete(
      "Insert every generated contract section in full.",
    )).toBe(true);
  });

  it("requires a suggested prompt without presenting repository review first", () => {
    const markup = renderPanel(workflow());

    expect(markup).toContain("Suggested prompt required");
    expect(markup).toContain("Create suggested prompt");
    expect(markup).toContain("Create the suggested implementation prompt");
    expect(markup).not.toContain("Invalid input: expected object, received null");
    expect(markup).toContain("leaves the saved result ready for review");
    expect(markup).not.toContain("Repository execution context");
    expect(markup).toMatch(/<button[^>]*disabled=""[^>]*>.*Suggested prompt required/s);
  });

  it("does not confuse incomplete ticket context with prompt evaluation", () => {
    const markup = renderPanel(workflow({
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
        }));

    expect(markup).toContain("Suggested prompt required");
    expect(markup).not.toContain("Complete the engineering ticket");
    expect(markup).not.toContain("Repository execution context");
  });

  it("identifies the exact agent prompt that will be tested", () => {
    const markup = renderPanel(workflow({
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
        }));

    expect(markup).toContain("Agent-written prompt");
    expect(markup).toContain("Revision 2");
    expect(markup).toContain("English");
    expect(markup).toContain(".prompt");
    expect(markup).toContain("# Correct large exports");
    expect(markup).toContain("This is the exact prompt Prompt Testing will compare");
    expect(markup).toContain("Agent-created prompt queued for Prompt Testing");
    expect(markup).toContain("will not restart the check when you revisit this page");
  });

  it("places the execution approval action below the explanatory callout", () => {
    const markup = renderPanel(readyPromptWorkflow());
    const approvalMarkup = renderPanel(workflow({
      ...readyPromptWorkflow(),
      verification: {
        id: "verification-1",
        status: "Ready for approval",
        userStory: "As a user, I want the input to work, so that I can finish.",
        promptHash: "b".repeat(64),
        pddVersion: "0.0.309",
        model: "openai/test",
        budgetUsd: 0.25,
        costUsd: 0.01,
        summary: "Generated one acceptance test.",
        generatedTests: [{
          path: "tests/input.test.ts",
          content: "test('input', () => {})",
          contentHash: "c".repeat(64),
          command: "npm test",
        }],
        failureMessage: null,
        createdAt: "2026-08-11T12:00:00.000Z",
        completedAt: "2026-08-11T12:01:00.000Z",
      },
      approval: {
        id: "approval-1",
        status: "Pending",
        expiresAt: "2026-08-12T12:00:00.000Z",
        promptHash: "b".repeat(64),
        repository: "closespan/app",
        baseBranch: "main",
        baseSha: "a".repeat(40),
        allowedCapabilities: ["repository:write"],
      },
    }));

    expect(markup).not.toContain("implementation-approval-section");
    expect(approvalMarkup).toContain(
      'class="workflow-callout-block implementation-approval-section"',
    );
    expect(approvalMarkup).toContain(
      'class="callout implementation-approval-callout"',
    );
    expect(approvalMarkup).toContain(
      '</p></div><div class="workflow-callout-actions implementation-approval-actions"><a class="btn primary" href="/approvals">Review execution approval</a></div>',
    );
  });

  it("explains a failed one-run authorization and offers a fresh coding run", () => {
    const candidate = readyPromptWorkflow();
    const markup = renderPanel({
      ...candidate,
      prompt: { ...candidate.prompt!, status: "Approved" },
      run: {
        id: "run-1",
        status: "Failed",
        branchName: "closespan/run-1",
        changedFiles: [],
        testResults: [],
        criterionResults: [],
        failureCode: "executor_failed",
        failureMessage: "The coding run stopped.",
        pullRequestUrl: null,
        queuedAt: "2026-08-11T12:00:00.000Z",
        completedAt: "2026-08-11T12:01:00.000Z",
      },
    });

    expect(markup).toContain("Prepare another coding run");
    expect(markup).toContain("Coding run failed");
    expect(markup).toContain("This one-run authorization ended");
    expect(markup).toContain("Review run");
    expect(markup).not.toContain("The approved run continues automatically");
    expect(markup).toContain(
      '</p></div><div class="workflow-callout-actions agent-run-actions"><a class="btn secondary" href="/agent-runs/run-1">Review run</a></div>',
    );
  });

  it("shows backend and frontend production verification independently", () => {
    const markup = renderPanel(workflow({
          releaseEvidence: {
            id: "verification-1",
            status: "Passed",
            environment: "production",
            evidence: "Both required sections passed.",
            specificationRevision: 3,
            verifiedBy: "automated_release_verifier",
            verifiedAt: "2026-08-11T00:00:00.000Z",
            productionVerification: {
              jobId: "job-1",
              backend: { status: "Passed", passedChecks: 2, totalChecks: 2 },
              frontend: { status: "Passed", passedChecks: 5, totalChecks: 5 },
              captures: [{ key: "home:desktop", viewport: "desktop" }],
            },
          },
        }));
    expect(markup).toContain("Backend");
    expect(markup).toContain("2 of 2 checks passed");
    expect(markup).toContain("Frontend");
    expect(markup).toContain("5 of 5 checks passed");
    expect(markup).toContain("desktop screenshot");
  });
});
