import { AppShell } from "@/components/app-shell";
import { OverviewScreen } from "@/components/screens";
import { getOverviewAnalytics } from "@/lib/overview-repository";
import { ORG_ID } from "@/lib/seed";

export const dynamic = "force-dynamic";

export default async function OverviewPage() {
  const analytics = await getOverviewAnalytics(ORG_ID);
  return <AppShell section="Executive overview"><OverviewScreen analytics={analytics}/></AppShell>;
}
