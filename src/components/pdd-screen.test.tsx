import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { calculateOverviewAnalytics } from "@/lib/overview-analytics";
import { primaryProblem, recommendation } from "@/lib/seed";
import {
  GenericProblemScreen,
  InvestigationVerificationFields,
  investigationDecisionContent,
  PddPrioritizationScreen,
  PddScreen,
  ProductProblemInvestigationPanel,
  runtimeVerificationElapsedLabel,
} from "./screens";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

describe("PddScreen", () => {
  const analytics = calculateOverviewAnalytics(
    new Date("2026-07-21T18:00:00.000Z"),
  );
  const investigation = {
    id: recommendation.id,
    problemId: primaryProblem.id,
    problemTitle: primaryProblem.title,
    title: `${primaryProblem.productArea} investigation`,
    status: "Ready for review",
    confidence: recommendation.confidence,
    signalConfidence: primaryProblem.confidence,
    relatedSignalCount: primaryProblem.feedbackIds.length,
    severity: primaryProblem.severity,
    stage: primaryProblem.stage,
    productArea: primaryProblem.productArea,
    team: primaryProblem.team,
    repository: primaryProblem.suspectedRepository,
    hypothesis: recommendation.hypothesis,
    assumptions: recommendation.assumptions,
    missingInformation: recommendation.missingInformation,
    proposedAction: recommendation.proposedAction,
    recommendedTests: recommendation.tests,
    suspectedFiles: primaryProblem.suspectedFiles,
    verification: {
      status: "Confirmed current",
      method: "Product reproduction",
      summary: "Reproduced in the current product build with the reported steps.",
      actorName: "Avery Chen",
      verifiedAt: "2026-08-08T00:00:00.000Z",
    },
    updatedAt: "2026-08-08T00:00:00.000Z",
  } as const;

  it("uses neumorphic listboxes for external verification choices", () => {
    const markup = renderToStaticMarkup(
      <InvestigationVerificationFields
        verificationStatus="Confirmed current"
        verificationMethod="Production telemetry"
        onVerificationStatusChange={vi.fn()}
        onVerificationMethodChange={vi.fn()}
      />,
    );

    expect(markup).toContain('class="custom-select investigation-verification-select"');
    expect(markup.match(/aria-haspopup="listbox"/g)).toHaveLength(2);
    expect(markup).toContain('aria-label="Outcome: Confirmed current"');
    expect(markup).toContain('aria-label="Verification method: Production telemetry"');
    expect(markup).toContain("Verification blocked");
    expect(markup).toContain("Release evidence");
    expect(markup).not.toContain("<select");
  });

  it("starts at prompt preparation without repeating investigation details", () => {
    const markup = renderToStaticMarkup(
      <PddScreen
        problems={analytics.problems}
        investigations={[investigation]}
        workflows={{}}
        selectedProblemId={primaryProblem.id}
        engineeringPanel={<section id="engineering-ticket">Prompt workflow</section>}
      />,
    );

    expect(markup).toContain("Prompt-driven development");
    expect(markup).not.toContain("Prompt Testing queue");
    expect(markup).toContain("Back to Prompt Testing priorities");
    expect(markup).toContain("Prompt preparation");
    expect(markup).toContain("Prompt evaluation");
    expect(markup).toContain("Approval readiness");
    expect(markup).toContain("View product problem");
    expect(markup).not.toContain("Hypothesis—not confirmed");
    expect(markup).toContain("Prompt workflow");
  });

  it("renders a ranked Prompt Testing list with readiness controls and a tracker per task", () => {
    const markup = renderToStaticMarkup(
      <PddPrioritizationScreen
        problems={analytics.problems}
        investigations={[investigation]}
        workflows={{}}
        repositoryReadyByProblem={Object.fromEntries(
          analytics.problems.map((problem) => [problem.id, true]),
        )}
      />,
    );

    expect(markup).toContain("Prompt Testing priorities");
    expect(markup).toContain("Rank: prompt-test readiness");
    expect(markup).toContain("All readiness states");
    expect(markup).toContain("Repository confirmed");
    expect(markup).toContain("Execution profile active");
    expect(markup).toContain("Implementation prompt ready");
    expect(markup).toContain("Acceptance tests generated");
    expect(markup).toContain("Open Prompt Testing task");
    expect(markup).toContain(`/pdd/${primaryProblem.id}#engineering-ticket`);
  });

  it("uses a true empty state when there are no open Prompt Testing tasks", () => {
    const markup = renderToStaticMarkup(
      <PddPrioritizationScreen
        problems={[]}
        investigations={[]}
        workflows={{}}
        repositoryReadyByProblem={{}}
      />,
    );

    expect(markup).toContain("No open Prompt Testing tasks");
    expect(markup).not.toContain("Choose another readiness state");
  });

  it("keeps investigation evidence on the product problem with a Prompt Testing handoff", () => {
    const problem = analytics.problems.find((item) => item.id === primaryProblem.id)!;
    const markup = renderToStaticMarkup(
      <ProductProblemInvestigationPanel problem={problem} investigation={investigation} />,
    );

    expect(markup).toContain("Investigation");
    expect(markup).toContain("Behavior confirmed · root cause unconfirmed");
    expect(markup).toContain("Details to confirm");
    expect(markup).toContain("Validation plan");
    expect(markup).toContain("Recommended action");
    expect(markup).not.toContain("Investigation confidence");
    expect(markup).toContain("Related signals");
    expect(markup).toContain("Validation checks");
    expect(markup).toContain("initial report confidence");
    expect(markup).toContain("Continue to prompt");
    expect(markup).toContain(`/pdd/${primaryProblem.id}#engineering-ticket`);
  });

  it("labels exact repository matches as leads and uses runtime evidence without claiming a root cause", () => {
    const problem = analytics.problems.find((item) => item.id === primaryProblem.id)!;
    const markup = renderToStaticMarkup(
      <ProductProblemInvestigationPanel
        problem={problem}
        investigation={investigation}
        evidenceBundle={{
          repository: "samshanmukh/zup",
          commitSha: "b".repeat(40),
          capturedAt: "2026-08-12T00:00:00.000Z",
          freshness: "Runtime commit",
          matches: [{
            path: "Zup/PostContextView.swift",
            startLine: 40,
            endLine: 72,
            declarations: ["PostContextView"],
            score: 94,
          }],
          relevantCodePaths: ["Zup/PostContextView.swift:40-72"],
          remainingEvidence: ["Capture the affected production configuration"],
          recommendedChecks: ["Run the nearest UI regression test."],
          runtimeVerification: {
            outcome: "Confirmed current",
            summary: "The Post Context input did not change the produced result.",
            expectedBehavior: "The result reflects the entered post context.",
            actualBehavior: "The result was unchanged after entering post context.",
            reproductionSteps: ["Enter post context", "Generate the result"],
            commands: [],
            observations: ["The input accepted text but the result ignored it."],
            artifacts: [],
            repository: "samshanmukh/zup",
            commitSha: "b".repeat(40),
            completedAt: "2026-08-12T00:00:00.000Z",
            runnerLabel: "tenki-macos",
            workflowRunId: 42,
          },
          contextStatus: "Exact commit",
          contextMessage: "1 source match from the pinned repository snapshot. Matches are investigation leads, not confirmed root cause.",
        }}
      />,
    );

    expect(markup).toContain("Repository context");
    expect(markup).toContain("samshanmukh/zup@bbbbbbbbbbbb");
    expect(markup).toContain("Runtime commit");
    expect(markup).toContain("Technical context");
    expect(markup).toContain("Zup/PostContextView.swift:40-72");
    expect(markup).toContain("Behavior confirmed · root cause unconfirmed");
    expect(markup).toContain("Capture the affected production configuration");
    expect(markup).not.toContain("Exact reproduction steps and the expected result");
  });

  it("distills feature requests into product decisions and hides internal repository artifacts", () => {
    expect(investigationDecisionContent({
      feedbackType: "Feature request",
      problemTitle: "Add more actions to the three-dot menu",
      evidenceToCollect: [
        "Resolve the current runtime verification blocker, then rerun the same scenario to compare expected and actual behavior.",
        "Exact reproduction steps and the expected result",
        "A failing trace, console error, or request identifier",
        "A second independent customer report or internal reproduction",
      ],
      recommendedChecks: [
        "Trace the reported behavior through .prompt/tickets/request.md:26-73 and confirm the runtime branch before changing it.",
        "Add an acceptance test for the expected user outcome",
        "Verify the existing workflow remains backward compatible",
      ],
      relevantCodePaths: [
        ".prompt/tickets/request.md:26-73",
        ".github/skills/impeccable/reference/init.md:2-49",
        "Zup/PostContextView.swift:40-72",
      ],
      assumptions: [
        "The three-dot menu currently duplicates the Edit action.",
        "The linked customer evidence belongs to the same product behavior.",
      ],
    })).toEqual({
      detailsToConfirm: [
        "Resolve the current runtime verification blocker, then rerun the same scenario to compare expected and actual behavior.",
        "Confirm the desired outcome and boundaries for “Add more actions to the three-dot menu”.",
        "Define the acceptance criteria for the requested workflow.",
      ],
      validationPlan: [
        "Add an acceptance test for the expected user outcome",
        "Verify the existing workflow remains backward compatible",
      ],
      productCodePaths: ["Zup/PostContextView.swift:40-72"],
      currentUnderstanding: ["The three-dot menu currently duplicates the Edit action."],
    });
  });

  it("explains a changed repository as a context refresh instead of an outage", () => {
    const problem = analytics.problems.find((item) => item.id === primaryProblem.id)!;
    const markup = renderToStaticMarkup(
      <ProductProblemInvestigationPanel
        problem={problem}
        investigation={investigation}
        evidenceBundle={{
          repository: "samshanmukh/zup",
          commitSha: "c1fefba22bd2".padEnd(40, "0"),
          capturedAt: "2026-08-12T00:00:00.000Z",
          freshness: "Runtime commit",
          matches: [],
          relevantCodePaths: [],
          remainingEvidence: investigation.missingInformation,
          recommendedChecks: investigation.recommendedTests,
          runtimeVerification: null,
          contextStatus: "Refresh required",
          contextMessage: "The repository changed after its context was indexed. Refresh context to analyze c1fefba22bd2 before generating a prompt.",
        }}
      />,
    );

    expect(markup).toContain("Refresh required");
    expect(markup).toContain("The repository changed after its context was indexed");
    expect(markup).toContain("investigation-context-refresh-capsule");
    expect(markup).toContain('aria-label="Refresh repository context"');
    expect(markup).not.toContain("Unavailable");
  });

  it("blocks Prompt Testing until the reported issue is verified in the current product", () => {
    const problem = analytics.problems.find((item) => item.id === primaryProblem.id)!;
    const unverified = {
      ...investigation,
      verification: {
        status: "Unverified" as const,
        method: null,
        summary: null,
        actorName: null,
        verifiedAt: null,
      },
    };
    const problemMarkup = renderToStaticMarkup(
      <ProductProblemInvestigationPanel problem={problem} investigation={unverified} />,
    );
    const pddMarkup = renderToStaticMarkup(
      <PddScreen
        problems={[problem]}
        investigations={[unverified]}
        workflows={{}}
        selectedProblemId={problem.id}
        engineeringPanel={<section>Prompt workflow</section>}
      />,
    );
    const prioritizationMarkup = renderToStaticMarkup(
      <PddPrioritizationScreen
        problems={[problem]}
        investigations={[unverified]}
        workflows={{}}
        repositoryReadyByProblem={{ [problem.id]: true }}
      />,
    );

    expect(problemMarkup).toContain("Current issue verification");
    expect(problemMarkup).toContain("Issue not yet reproduced");
    expect(problemMarkup).toContain("Run issue verification");
    expect(problemMarkup).toContain("accept decisive code evidence");
    expect(problemMarkup).toContain("runtime or UI testing only when necessary");
    expect(problemMarkup).toContain("Record external evidence");
    expect(problemMarkup).not.toContain("Continue to prompt");
    expect(pddMarkup).toContain("Current issue verification required");
    expect(pddMarkup).not.toContain("Prompt workflow");
    expect(prioritizationMarkup).toContain("Issue verification required");
    expect(prioritizationMarkup).toContain("Open Prompt Testing task");
    expect(prioritizationMarkup).toContain(`/pdd/${problem.id}#engineering-ticket`);
  });

  it("shows an active Tenki runtime run and keeps prompt testing locked", () => {
    const problem = analytics.problems.find((item) => item.id === primaryProblem.id)!;
    const running = {
      ...investigation,
      verification: {
        status: "Unverified" as const,
        method: null,
        summary: null,
        actorName: null,
        verifiedAt: null,
      },
      runtimeVerification: {
        id: "11111111-1111-4111-8111-111111111111",
        status: "Running" as const,
        outcome: null,
        repository: "samshanmukh/zup",
        baseSha: "a".repeat(40),
        summary: null,
        failureMessage: null,
        requestedByName: "Shanmukh Sain",
        requestedAt: "2026-08-12T10:00:00.000Z",
        startedAt: "2026-08-12T10:01:00.000Z",
        completedAt: null,
        workflowRunId: null,
      },
    };
    const problemMarkup = renderToStaticMarkup(
      <ProductProblemInvestigationPanel problem={problem} investigation={running} />,
    );
    const priorityMarkup = renderToStaticMarkup(
      <PddPrioritizationScreen
        problems={[problem]}
        investigations={[running]}
        workflows={{}}
        repositoryReadyByProblem={{ [problem.id]: true }}
      />,
    );

    expect(problemMarkup).toContain("Running on Tenki");
    expect(problemMarkup).toContain("Verification in progress");
    expect(problemMarkup).toContain("samshanmukh/zup · aaaaaaaaaaaa");
    expect(problemMarkup).not.toContain("Continue to prompt");
    expect(priorityMarkup).toContain("Runtime verification running");
    expect(priorityMarkup).toContain("Open Prompt Testing task");
    expect(priorityMarkup).toContain(`/pdd/${problem.id}#engineering-ticket`);
  });

  it("distinguishes queue time from execution time and exposes the deadline", () => {
    expect(runtimeVerificationElapsedLabel({
      status: "Queued",
      requestedAt: "2026-08-12T10:00:00.000Z",
      startedAt: null,
    }, Date.parse("2026-08-12T10:02:30.000Z"))).toBe(
      "Queued for 2m 30s · timeout in 2m 30s",
    );
    expect(runtimeVerificationElapsedLabel({
      status: "Running",
      requestedAt: "2026-08-12T10:00:00.000Z",
      startedAt: "2026-08-12T10:03:00.000Z",
    }, Date.parse("2026-08-12T10:04:30.000Z"))).toBe(
      "Running for 1m 30s · timeout in 1h 18m",
    );
  });

  it("offers a retry after automated runtime verification times out", () => {
    const problem = analytics.problems.find((item) => item.id === primaryProblem.id)!;
    const timeoutMessage = "Runner unavailable. Tenki did not assign the configured verification runner within 5 minutes, so CloseSpan stopped the verification and requested cancellation of its GitHub workflow. Confirm the runner is available, then retry.";
    const timedOut = {
      ...investigation,
      verification: {
        status: "Verification blocked" as const,
        method: "Automated check" as const,
        summary: timeoutMessage,
        actorName: "Tenki runtime verifier",
        verifiedAt: "2026-08-12T10:05:00.000Z",
      },
      runtimeVerification: {
        id: "22222222-2222-4222-8222-222222222222",
        status: "Failed" as const,
        outcome: "Verification blocked" as const,
        repository: "samshanmukh/zup",
        baseSha: "b".repeat(40),
        summary: timeoutMessage,
        failureMessage: timeoutMessage,
        requestedByName: "Shanmukh Sain",
        requestedAt: "2026-08-12T10:00:00.000Z",
        startedAt: null,
        completedAt: "2026-08-12T10:05:00.000Z",
        workflowRunId: null,
      },
    };

    const markup = renderToStaticMarkup(
      <ProductProblemInvestigationPanel problem={problem} investigation={timedOut} />,
    );

    expect(markup).toContain("Retry issue verification");
    expect(markup).toContain("Runner unavailable");
    expect(markup).toContain("requested cancellation of its GitHub workflow");
    expect(markup).not.toContain("Verification in progress");
  });

  it("keeps a verification-blocked task inside Prompt Testing and offers a separate recovery action", () => {
    const problem = analytics.problems.find((item) => item.id === primaryProblem.id)!;
    const blocked = {
      ...investigation,
      verification: {
        status: "Verification blocked" as const,
        method: "Product reproduction" as const,
        summary: "Hosted-AI permission prevented a decisive comparison.",
        actorName: "Avery Chen",
        verifiedAt: "2026-08-12T00:00:00.000Z",
      },
    };
    const markup = renderToStaticMarkup(
      <PddScreen
        problems={[problem]}
        investigations={[blocked]}
        workflows={{}}
        selectedProblemId={problem.id}
        engineeringPanel={<section>Prompt workflow</section>}
      />,
    );

    expect(markup).toContain("Current issue verification blocked");
    expect(markup).toContain("Prompt testing is paused");
    expect(markup).toContain("Resolve verification blocker");
    expect(markup).toContain(`/problems/${problem.id}#investigation`);
    expect(markup).not.toContain("Prompt workflow");
  });

  it("removes the lifecycle sidebar and the duplicate confidence metric", () => {
    const problem = analytics.problems.find((item) => item.id === primaryProblem.id)!;
    const markup = renderToStaticMarkup(
      <GenericProblemScreen
        problem={problem}
        investigation={investigation}
        promptDraftReadiness={{
          problemId: problem.id,
          investigationId: investigation.id,
          investigationConfidence: investigation.confidence,
          requiredConfidence: 0.6,
          evidenceCount: investigation.relatedSignalCount,
          requiredEvidence: 1,
          hasInvestigation: true,
          verificationStatus: "Confirmed current",
          hasExistingWorkflow: true,
          repositoryReady: true,
          signalConfidenceFactors: null,
          canGenerate: true,
          reason: "Ready",
        }}
      />,
    );

    expect(markup).not.toContain("<h2>Lifecycle</h2>");
    expect(markup).not.toContain("Investigation confidence");
    expect(markup).toContain("Signal match confidence");
    expect(markup).toContain("Required for prompt drafting");
    expect(markup).toContain("Related signals");
    expect(markup).toContain("Evidence still needed");
    expect(markup).toContain("Recommended checks");
    expect(markup).toContain('aria-label="What related signals means"');
    expect(markup).toContain('aria-label="What evidence still needed means"');
    expect(markup).toContain('aria-label="What recommended checks means"');
    expect(markup).toContain("Ready for review");
    expect(markup).toContain("Back to problems");
  });

  it("explains when Cognee assisted signal retrieval without relabeling the final score", () => {
    const problem = analytics.problems.find((item) => item.id === primaryProblem.id)!;
    const markup = renderToStaticMarkup(
      <GenericProblemScreen
        problem={problem}
        investigation={investigation}
        promptDraftReadiness={{
          problemId: problem.id,
          investigationId: investigation.id,
          investigationConfidence: investigation.confidence,
          requiredConfidence: 0.6,
          evidenceCount: investigation.relatedSignalCount,
          requiredEvidence: 1,
          hasInvestigation: true,
          verificationStatus: "Confirmed current",
          hasExistingWorkflow: true,
          repositoryReady: true,
          signalConfidenceFactors: {
            clusterMatch: 0.96,
            evidenceQuality: 0.9,
            lowAmbiguity: 0.92,
            cogneeRetrieved: true,
            cogneeBestRank: 2,
          },
          canGenerate: true,
          reason: "Ready",
        }}
      />,
    );

    expect(markup).toContain("Semantic match (Cognee-assisted)");
    expect(markup).toContain("Cognee retrieved the accepted problem at rank 2");
    expect(markup).toContain("CloseSpan independently evaluated the semantic fit");
  });

  it("can omit the repeated investigation summary after it moves to available evidence", () => {
    const problem = analytics.problems.find((item) => item.id === primaryProblem.id)!;
    const markup = renderToStaticMarkup(
      <ProductProblemInvestigationPanel
        problem={problem}
        investigation={investigation}
        showSummary={false}
      />,
    );

    expect(markup).toContain("Investigation");
    expect(markup).toContain("Behavior confirmed · root cause unconfirmed");
    expect(markup).not.toContain("Related signals");
    expect(markup).not.toContain("Evidence still needed");
  });
});
