import { AgentRunFinding } from "@/components/agent-run-finding";
import { readIssueRunFindings } from "@/lib/agent-run-findings-repository";
import { notFound } from "next/navigation";
import { ProblemEvidence, ProblemHistory } from "@/components/problem-workspace";
import { GenericProblemScreen, IssueFollowUp, ProductProblemInvestigationPanel } from "@/components/screens";
import { readPromptDraftReadiness } from "@/lib/automated-prompt-draft-repository";
import { requireWorkspaceUser } from "@/lib/auth-user";
import { listWorkspaceInvestigations } from "@/lib/investigation-repository";
import { findState } from "@/lib/store";
import { getWorkspaceData, getWorkspaceProblem } from "@/lib/workspace-repository";
import { listIssueHistory } from "@/lib/issue-history-repository";
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
  const runFindings = await readIssueRunFindings(user.orgId, problemId);
  const findingEvidence = runFindings.length ? <section className="card"><div className="card-body">{runFindings.map((finding) => <AgentRunFinding key={finding.id} finding={finding} canCreate={false} storageReady={true} />)}</div></section> : null;
  const discussion = <ProblemDiscussion key={problemId} problemId={problemId} initial={conversation} currentPromptHash={null}
    canDiscuss={["Admin", "Contributor"].includes(user.role)} canRevise={false} canTest={false} demo={demo}
    disabledReason={process.env.APP_MODE === "demo" ? "Live conversation is off in demo mode." : undefined} />;
  const investigation = investigations.find((item) => item.problemId === problemId);
  const evidenceBundle = investigation
    ? await getProductProblemEvidenceBundle(user.orgId, problemId)
    : null;
  // Every issue uses the same page. Evidence, follow-up and history appear
  // whenever this issue has the underlying records.
  const [promptDraftReadiness, domainProblem, workflow] = await Promise.all([
    readPromptDraftReadiness(user.orgId, problemId),
    getWorkspaceProblem(user.orgId, problemId),
    findState(user.orgId, problemId),
  ]);
  const history = await listIssueHistory(user.orgId, problemId, workflow);
  return <>
    {findingEvidence}
    <GenericProblemScreen problem={problem} promptDraftReadiness={structuredClone(promptDraftReadiness)} investigation={structuredClone(investigation)} discussion={discussion}/>
    {domainProblem && <ProblemEvidence problem={structuredClone(domainProblem)} feedbackItems={data.feedback}/>}
    <ProductProblemInvestigationPanel problem={structuredClone(problem)} investigation={structuredClone(investigation)} evidenceBundle={structuredClone(evidenceBundle)} showSummary={false}/>
    {workflow && <IssueFollowUp initialState={structuredClone(workflow)} problem={{ id: problem.id, title: problem.title }} orgId={user.orgId} feedbackItems={data.feedback}/>}
    {history.length > 0 && <ProblemHistory audit={structuredClone(history)}/>}
  </>;
}
