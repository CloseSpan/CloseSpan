import { InvestigationsScreen } from "@/components/screens";
import { requireWorkspaceUser } from "@/lib/auth-user"; import { getWorkspaceData } from "@/lib/workspace-repository";
export const dynamic="force-dynamic";
export default async function Page(){const user=await requireWorkspaceUser();const data=await getWorkspaceData(user.orgId);return <InvestigationsScreen problem={data.primaryProblem} investigation={data.recommendation} queue={data.investigationQueue}/>}
