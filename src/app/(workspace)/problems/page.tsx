import { ProblemsScreen } from "@/components/screens";
import { requireWorkspaceUser } from "@/lib/auth-user";
import { getOverviewAnalytics } from "@/lib/overview-repository";

export const dynamic = "force-dynamic";

export default async function Page() {
  const user = await requireWorkspaceUser();
  const analytics = await getOverviewAnalytics(user.orgId);

  return <ProblemsScreen analytics={analytics} />;
}
