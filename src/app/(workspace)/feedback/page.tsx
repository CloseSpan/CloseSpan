import { FeedbackScreen } from "@/components/screens";
import { requireWorkspaceUser } from "@/lib/auth-user"; import { getWorkspaceData } from "@/lib/workspace-repository";
import { listLatestFeedbackAnalyses } from "@/lib/ai-repository";
export const dynamic="force-dynamic";
export default async function Page(){const user=await requireWorkspaceUser();const [data,initialAnalyses]=await Promise.all([getWorkspaceData(user.orgId),listLatestFeedbackAnalyses(user.orgId)]);return <FeedbackScreen feedbackItems={data.feedback} orgId={data.orgId} providerLabel={data.settings.ai.providerLabel} initialAnalyses={initialAnalyses} problemOptions={data.analytics.problems.map(({id,title,stage}) => ({id,title,stage}))}/>}
