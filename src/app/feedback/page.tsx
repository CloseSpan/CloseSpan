import { AppShell } from "@/components/app-shell"; import { FeedbackScreen } from "@/components/screens";
import { getWorkspaceData } from "@/lib/workspace-repository"; import { ORG_ID } from "@/lib/seed";
export const dynamic="force-dynamic";
export default async function Page(){const data=await getWorkspaceData(ORG_ID);return <AppShell section="Feedback inbox"><FeedbackScreen feedbackItems={data.feedback} orgId={data.orgId} providerLabel={data.settings.ai.providerLabel}/></AppShell>}
