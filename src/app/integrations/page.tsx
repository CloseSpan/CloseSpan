import { AppShell } from "@/components/app-shell"; import { IntegrationsScreen } from "@/components/screens";
import { requireWorkspaceUser } from "@/lib/auth-user"; import { getWorkspaceData } from "@/lib/workspace-repository";
export const dynamic="force-dynamic";
export default async function Page(){const user=await requireWorkspaceUser();const data=await getWorkspaceData(user.orgId);return <AppShell section="Integrations" user={user}><IntegrationsScreen integrations={data.integrations} orgId={user.orgId}/></AppShell>}
