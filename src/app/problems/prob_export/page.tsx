import { AppShell } from "@/components/app-shell";
import { ProblemWorkspace } from "@/components/problem-workspace";
import { getState } from "@/lib/store";
import { ORG_ID } from "@/lib/seed";
import { getWorkspaceData } from "@/lib/workspace-repository";

export const dynamic = "force-dynamic";

export default async function ProblemDetailPage() {
  const [state,data]=await Promise.all([getState(ORG_ID),getWorkspaceData(ORG_ID)]);
  return <AppShell section="Product problems › FF-142"><ProblemWorkspace initialState={structuredClone(state)} problem={data.primaryProblem} feedbackItems={data.feedback} investigation={data.recommendation}/></AppShell>;
}
