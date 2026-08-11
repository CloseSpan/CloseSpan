import { redirect } from "next/navigation";
import { InvestigationsScreen } from "@/components/screens";
import { requireWorkspaceUser } from "@/lib/auth-user";
import { listWorkspaceInvestigations } from "@/lib/investigation-repository";

export const dynamic = "force-dynamic";

export default async function Page() {
  const user = await requireWorkspaceUser();
  const investigations = await listWorkspaceInvestigations(user.orgId);
  const first = investigations[0];

  if (first) redirect(`/investigations/${encodeURIComponent(first.id)}`);

  return (
    <InvestigationsScreen
      investigations={investigations}
      selectedInvestigationId={null}
    />
  );
}
