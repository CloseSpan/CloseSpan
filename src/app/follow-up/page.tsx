import { AppShell } from "@/components/app-shell"; import { FollowUpScreen } from "@/components/screens";
import { getState } from "@/lib/store"; import { ORG_ID } from "@/lib/seed";
import { getWorkspaceData } from "@/lib/workspace-repository";
export const dynamic = "force-dynamic";
export default async function Page(){const [state,data]=await Promise.all([getState(ORG_ID),getWorkspaceData(ORG_ID)]);return <AppShell section="Customer follow-up"><FollowUpScreen initialState={structuredClone(state)} problem={data.primaryProblem} feedbackItems={data.feedback}/></AppShell>}
