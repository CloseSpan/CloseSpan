import { AppShell } from "@/components/app-shell";
import { OverviewScreen } from "@/components/screens";
import { requireWorkspaceUser } from "@/lib/auth-user";
import { getOverviewAnalytics } from "@/lib/overview-repository";

export const dynamic = "force-dynamic";

export default async function OverviewPage() {
  const user = await requireWorkspaceUser();
  const analytics = await getOverviewAnalytics(user.orgId);
  return <AppShell section="Executive overview" user={user}><OverviewScreen analytics={analytics}/></AppShell>;
}
