import { AppShell } from "@/components/app-shell"; import { CustomersScreen } from "@/components/screens";
import { getWorkspaceData } from "@/lib/workspace-repository"; import { ORG_ID } from "@/lib/seed";
export const dynamic="force-dynamic";
export default async function Page(){const data=await getWorkspaceData(ORG_ID);return <AppShell section="Customers"><CustomersScreen customers={data.customers}/></AppShell>}
