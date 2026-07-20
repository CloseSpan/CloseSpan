import { AppShell } from "@/components/app-shell"; import { ApprovalsScreen } from "@/components/screens";
import { requireWorkspaceUser } from "@/lib/auth-user";
import { findState } from "@/lib/store";
import { getWorkspaceData } from "@/lib/workspace-repository";
export const dynamic = "force-dynamic";
export default async function Page(){const user=await requireWorkspaceUser();const [state,data]=await Promise.all([findState(user.orgId),getWorkspaceData(user.orgId)]);return <AppShell section="Approval center" user={user}><ApprovalsScreen initialState={state ? structuredClone(state) : null} problem={data.primaryProblem} investigation={data.recommendation} queue={data.investigationQueue}/></AppShell>}
