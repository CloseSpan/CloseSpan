import { AppShell } from "@/components/app-shell"; import { IntegrationsScreen } from "@/components/screens";
import { getWorkspaceData } from "@/lib/workspace-repository"; import { ORG_ID } from "@/lib/seed";
export const dynamic="force-dynamic";
export default async function Page(){const data=await getWorkspaceData(ORG_ID);return <AppShell section="Integrations"><IntegrationsScreen integrations={data.integrations}/></AppShell>}
