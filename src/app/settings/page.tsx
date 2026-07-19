import { AppShell } from "@/components/app-shell"; import { SettingsScreen } from "@/components/settings-screen";
import { requireWorkspaceUser } from "@/lib/auth-user"; import { getWorkspaceData } from "@/lib/workspace-repository";
export const dynamic="force-dynamic";
export default async function Page(){const user=await requireWorkspaceUser();const data=await getWorkspaceData(user.orgId);return <AppShell section="Settings & governance" user={user}><SettingsScreen settings={data.settings} orgId={data.orgId}/></AppShell>}
