import { ApprovalsScreen } from "@/components/screens";
import { requireWorkspaceUser } from "@/lib/auth-user";
import { listEngineeringApprovalWorkflows } from "@/lib/engineering-workflow-repository";
import { getWorkspaceData } from "@/lib/workspace-repository";
export const dynamic = "force-dynamic";
export default async function Page(){const user=await requireWorkspaceUser();const [data,workflows]=await Promise.all([getWorkspaceData(user.orgId),listEngineeringApprovalWorkflows(user.orgId)]);return <ApprovalsScreen problem={data.primaryProblem} problemTitles={Object.fromEntries(data.analytics.problems.map((problem)=>[problem.id,problem.title]))} initialEngineeringWorkflows={structuredClone(workflows)} orgId={user.orgId}/>}
