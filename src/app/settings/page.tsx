import { AppShell } from "@/components/app-shell"; import { SettingsScreen } from "@/components/settings-screen";
import { getWorkspaceData } from "@/lib/workspace-repository"; import { ORG_ID } from "@/lib/seed";
export const dynamic="force-dynamic";
export default async function Page(){const data=await getWorkspaceData(ORG_ID);return <AppShell section="Settings & governance"><SettingsScreen settings={data.settings} orgId={data.orgId}/></AppShell>}
