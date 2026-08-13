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
      return <><ProblemWorkspace initialState={structuredClone(state)} problem={data.primaryProblem} feedbackItems={data.feedback}/><ProductProblemInvestigationPanel problem={structuredClone(problem)} investigation={structuredClone(investigation)} evidenceBundle={structuredClone(evidenceBundle)}/><ProblemHistory audit={structuredClone(problemAudit)}/></>;
    }
  }
  const promptDraftReadiness = await readPromptDraftReadiness(user.orgId, problemId);
  return <><GenericProblemScreen problem={problem} promptDraftReadiness={structuredClone(promptDraftReadiness)} investigation={structuredClone(investigation)}/><ProductProblemInvestigationPanel problem={structuredClone(problem)} investigation={structuredClone(investigation)} evidenceBundle={structuredClone(evidenceBundle)} showSummary={false}/></>;
}
