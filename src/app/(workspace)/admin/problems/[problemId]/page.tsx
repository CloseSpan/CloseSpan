import { ProblemReviewDiagnostics } from "@/components/problem-review-diagnostics";
import { readProblemPromptReview } from "@/lib/problem-prompt-review-repository";
import { notFound } from "next/navigation";
import { ProblemEvidence, ProblemHistory } from "@/components/problem-workspace";
import { GenericProblemScreen, ProductProblemInvestigationPanel } from "@/components/screens";
import { readPromptDraftReadiness } from "@/lib/automated-prompt-draft-repository";
import { requireWorkspaceUser } from "@/lib/auth-user";
import { listWorkspaceInvestigations } from "@/lib/investigation-repository";
import { findState } from "@/lib/store";
import { getWorkspaceData, getWorkspaceProblem } from "@/lib/workspace-repository";
import { listIssueHistory } from "@/lib/issue-history-repository";
import { getProductProblemEvidenceBundle } from "@/lib/problem-evidence-bundle";
import { reconcileStaleIssueRuntimeVerifications } from "@/lib/issue-runtime-verification";

export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ problemId: string }> }) {
  const user = await requireWorkspaceUser();
  if (user.role !== "Admin") notFound();
  const { problemId } = await params;
  await reconcileStaleIssueRuntimeVerifications(user.orgId);
  const [data, investigations] = await Promise.all([
    getWorkspaceData(user.orgId),
    listWorkspaceInvestigations(user.orgId),
  ]);
  const problem = data.analytics.problems.find((item) => item.id === problemId);
  if (!problem) notFound();
  const review = await readProblemPromptReview(user.orgId, problemId);
  const investigation = investigations.find((item) => item.problemId === problemId);
  const evidenceBundle = investigation
    ? await getProductProblemEvidenceBundle(user.orgId, problemId)
    : null;
  const [promptDraftReadiness, domainProblem, workflow] = await Promise.all([
    readPromptDraftReadiness(user.orgId, problemId),
    getWorkspaceProblem(user.orgId, problemId),
    findState(user.orgId, problemId),
  ]);
  const history = await listIssueHistory(user.orgId, problemId, workflow);
  return <>
    <ProblemReviewDiagnostics problemId={problemId} review={review}/>
    <GenericProblemScreen problem={problem} promptDraftReadiness={structuredClone(promptDraftReadiness)} investigation={structuredClone(investigation)}/>
    {domainProblem && <ProblemEvidence problem={structuredClone(domainProblem)} feedbackItems={data.feedback}/>}
    <ProductProblemInvestigationPanel problem={structuredClone(problem)} investigation={structuredClone(investigation)} evidenceBundle={structuredClone(evidenceBundle)} showSummary={false}/>
    {history.length > 0 && <ProblemHistory audit={structuredClone(history)}/>}
  </>;
}
