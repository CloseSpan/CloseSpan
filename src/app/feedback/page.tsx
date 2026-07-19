import { AppShell } from "@/components/app-shell"; import { FeedbackScreen } from "@/components/screens";
import { requireWorkspaceUser } from "@/lib/auth-user"; import { getWorkspaceData } from "@/lib/workspace-repository";
export const dynamic="force-dynamic";
export default async function Page(){const user=await requireWorkspaceUser();const data=await getWorkspaceData(user.orgId);return <AppShell section="Feedback inbox" user={user}><FeedbackScreen feedbackItems={data.feedback} orgId={data.orgId} providerLabel={data.settings.ai.providerLabel}/></AppShell>}
