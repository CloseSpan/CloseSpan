import { notFound } from "next/navigation";
import { ProblemHistory, ProblemWorkspace } from "@/components/problem-workspace";
import { GenericProblemScreen } from "@/components/screens";
import { EngineeringTicketPanel } from "@/components/engineering-ticket-panel";
import { readPromptDraftReadiness } from "@/lib/automated-prompt-draft-repository";
import { requireWorkspaceUser } from "@/lib/auth-user";
import { getEngineeringWorkflow } from "@/lib/engineering-workflow-repository";
import { findState } from "@/lib/store";
import { getWorkspaceData } from "@/lib/workspace-repository";
import { readPddPromptTimingSummary } from "@/lib/pdd-prompt-timing-repository";

export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ problemId: string }> }) {
  const user = await requireWorkspaceUser();
  const { problemId } = await params;
  const data = await getWorkspaceData(user.orgId);
  const problem = data.analytics.problems.find((item) => item.id === problemId);
  if (!problem) notFound();
  const [engineeringWorkflow, promptDraftReadiness, pddTiming] = await Promise.all([
    getEngineeringWorkflow(user.orgId, problemId),
    readPromptDraftReadiness(user.orgId, problemId),
    readPddPromptTimingSummary(user.orgId),
  ]);
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
        engineeringWorkflow.prompt?.id,
        engineeringWorkflow.verification?.id,
        engineeringWorkflow.approval?.id,
        engineeringWorkflow.run?.id,
        engineeringWorkflow.releaseEvidence?.id,
      ].filter((id): id is string => Boolean(id)));
      const problemAudit = state.audit.filter((event) =>
        relatedAuditEntityIds.has(event.entityId) || event.traceId.includes(problemId),
      );
      return <><ProblemWorkspace initialState={structuredClone(state)} problem={data.primaryProblem} feedbackItems={data.feedback} investigation={data.recommendation} engineeringPanel={<EngineeringTicketPanel orgId={user.orgId} problemId={problemId} initialWorkflow={structuredClone(engineeringWorkflow)} initialPddTiming={structuredClone(pddTiming)}/>}/><ProblemHistory audit={structuredClone(problemAudit)}/></>;
    }
  }
  return <><GenericProblemScreen problem={problem} promptDraftReadiness={structuredClone(promptDraftReadiness)}/><EngineeringTicketPanel orgId={user.orgId} problemId={problemId} initialWorkflow={structuredClone(engineeringWorkflow)} initialPddTiming={structuredClone(pddTiming)}/></>;
}
