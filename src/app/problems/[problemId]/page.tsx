import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { ProblemWorkspace } from "@/components/problem-workspace";
import { GenericProblemScreen } from "@/components/screens";
import { requireWorkspaceUser } from "@/lib/auth-user";
import { findState } from "@/lib/store";
import { getWorkspaceData } from "@/lib/workspace-repository";

export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ problemId: string }> }) {
  const user = await requireWorkspaceUser();
  const { problemId } = await params;
  const data = await getWorkspaceData(user.orgId);
  const problem = data.analytics.problems.find((item) => item.id === problemId);
  if (!problem) notFound();
  if (
    data.primaryProblem?.id === problemId &&
    data.recommendation
  ) {
    const state = await findState(user.orgId);
    if (state) {
      return <AppShell section={`Product problems › ${problem.title}`} user={user}><ProblemWorkspace initialState={structuredClone(state)} problem={data.primaryProblem} feedbackItems={data.feedback} investigation={data.recommendation}/></AppShell>;
    }
  }
  return <AppShell section="Product problems" user={user}><GenericProblemScreen problem={problem}/></AppShell>;
}
