import { AppShell } from "@/components/app-shell"; import { InvestigationsScreen } from "@/components/screens";
import { getWorkspaceData } from "@/lib/workspace-repository"; import { ORG_ID } from "@/lib/seed";
export const dynamic="force-dynamic";
export default async function Page(){const data=await getWorkspaceData(ORG_ID);return <AppShell section="AI investigations"><InvestigationsScreen problem={data.primaryProblem} investigation={data.recommendation} queue={data.investigationQueue}/></AppShell>}
