import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { ProblemWorkspace } from "@/components/problem-workspace";
import { GenericProblemScreen } from "@/components/screens";
import { EngineeringTicketPanel } from "@/components/engineering-ticket-panel";
import { requireWorkspaceUser } from "@/lib/auth-user";
import { getEngineeringWorkflow } from "@/lib/engineering-workflow-repository";
import { findState } from "@/lib/store";
import { getWorkspaceData } from "@/lib/workspace-repository";

export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ problemId: string }> }) {
  const user = await requireWorkspaceUser();
  const { problemId } = await params;
  const data = await getWorkspaceData(user.orgId);
  const problem = data.analytics.problems.find((item) => item.id === problemId);
  if (!problem) notFound();
  const engineeringWorkflow = await getEngineeringWorkflow(user.orgId, problemId);
  if (
    data.primaryProblem?.id === problemId &&
    data.recommendation
  ) {
    const state = await findState(user.orgId);
    if (state) {
      return <AppShell section={`Product problems › ${problem.title}`} user={user}><ProblemWorkspace initialState={structuredClone(state)} problem={data.primaryProblem} feedbackItems={data.feedback} investigation={data.recommendation}/><EngineeringTicketPanel orgId={user.orgId} problemId={problemId} initialWorkflow={structuredClone(engineeringWorkflow)}/></AppShell>;
    }
  }
  return <AppShell section="Product problems" user={user}><GenericProblemScreen problem={problem}/><EngineeringTicketPanel orgId={user.orgId} problemId={problemId} initialWorkflow={structuredClone(engineeringWorkflow)}/></AppShell>;
}
