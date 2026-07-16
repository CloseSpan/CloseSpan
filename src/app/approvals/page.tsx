import { AppShell } from "@/components/app-shell"; import { ApprovalsScreen } from "@/components/screens";
import { getState } from "@/lib/store"; import { ORG_ID } from "@/lib/seed";
export const dynamic = "force-dynamic";
export default function Page(){return <AppShell section="Approval center"><ApprovalsScreen initialState={structuredClone(getState(ORG_ID))}/></AppShell>}
