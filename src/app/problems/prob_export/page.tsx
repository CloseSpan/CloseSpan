import { AppShell } from "@/components/app-shell";
import { ProblemWorkspace } from "@/components/problem-workspace";
import { requireWorkspaceUser } from "@/lib/auth-user";
import { getState } from "@/lib/store";
import { getWorkspaceData } from "@/lib/workspace-repository";

export const dynamic = "force-dynamic";

export default async function ProblemDetailPage() {
  const user = await requireWorkspaceUser();
  const [state,data]=await Promise.all([getState(user.orgId),getWorkspaceData(user.orgId)]);
  return <AppShell section="Product problems › FF-142" user={user}><ProblemWorkspace initialState={structuredClone(state)} problem={data.primaryProblem} feedbackItems={data.feedback} investigation={data.recommendation}/></AppShell>;
}
