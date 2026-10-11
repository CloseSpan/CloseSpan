import { AgentRunFinding } from "@/components/agent-run-finding";
import { readIssueRunFinding } from "@/lib/agent-run-findings-repository";
import { notFound } from "next/navigation";
import { ProblemHistory, ProblemWorkspace } from "@/components/problem-workspace";
import { GenericProblemScreen, ProductProblemInvestigationPanel } from "@/components/screens";
import { readPromptDraftReadiness } from "@/lib/automated-prompt-draft-repository";
import { requireWorkspaceUser } from "@/lib/auth-user";
import { listWorkspaceInvestigations } from "@/lib/investigation-repository";
import { findState } from "@/lib/store";
import { getWorkspaceData } from "@/lib/workspace-repository";
import { getProductProblemEvidenceBundle } from "@/lib/problem-evidence-bundle";
import { reconcileStaleIssueRuntimeVerifications } from "@/lib/issue-runtime-verification";
import { readIssueConversation } from "@/lib/issue-conversation-repository";
import { readPresentationDemo } from "@/lib/presentation-demo";
import { ProblemDiscussion } from "@/components/problem-discussion";

export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ problemId: string }> }) {
  const user = await requireWorkspaceUser();
  const { problemId } = await params;
  await reconcileStaleIssueRuntimeVerifications(user.orgId);
  const [data, investigations] = await Promise.all([
    getWorkspaceData(user.orgId),
    listWorkspaceInvestigations(user.orgId),
  ]);
  const problem = data.analytics.problems.find((item) => item.id === problemId);
  if (!problem) notFound();
  const [conversation, demo] = await Promise.all([readIssueConversation(user.orgId, problemId), readPresentationDemo(user.orgId)]);
  const runFinding = await readIssueRunFinding(user.orgId, problemId);
  const findingEvidence = runFinding ? <section className="card"><div className="card-body"><AgentRunFinding finding={runFinding} canCreate={false} storageReady={true} /></div></section> : null;
  const discussion = <ProblemDiscussion key={problemId} problemId={problemId} initial={conversation} currentPromptHash={null}
    canDiscuss={["Admin", "Contributor"].includes(user.role)} canRevise={false} canTest={false} demo={demo}
    disabledReason={process.env.APP_MODE === "demo" ? "Live conversation is off in demo mode." : undefined} />;
  const investigation = investigations.find((item) => item.problemId === problemId);
  const evidenceBundle = investigation
    ? await getProductProblemEvidenceBundle(user.orgId, problemId)
    : null;
  if (
    data.primaryProblem?.id === problemId &&
    data.recommendation
  ) {
    const state = await findState(user.orgId);
    if (state) {
      const relatedAuditEntityIds = new Set([
        problemId,
        state.approval.id,
        state.workItem?.id,
      ].filter((id): id is string => Boolean(id)));
      const problemAudit = state.audit.filter((event) =>
        relatedAuditEntityIds.has(event.entityId) || event.traceId.includes(problemId),
      );
      return <>{findingEvidence}<ProblemWorkspace initialState={structuredClone(state)} problem={data.primaryProblem} feedbackItems={data.feedback} discussion={discussion}/><ProductProblemInvestigationPanel problem={structuredClone(problem)} investigation={structuredClone(investigation)} evidenceBundle={structuredClone(evidenceBundle)}/><ProblemHistory audit={structuredClone(problemAudit)}/></>;
    }
  }
  const promptDraftReadiness = await readPromptDraftReadiness(user.orgId, problemId);
  return <>{findingEvidence}<GenericProblemScreen problem={problem} promptDraftReadiness={structuredClone(promptDraftReadiness)} investigation={structuredClone(investigation)} discussion={discussion}/><ProductProblemInvestigationPanel problem={structuredClone(problem)} investigation={structuredClone(investigation)} evidenceBundle={structuredClone(evidenceBundle)} showSummary={false}/></>;
}
