import { notFound } from "next/navigation";
import { InvestigationsScreen } from "@/components/screens";
import { requireWorkspaceUser } from "@/lib/auth-user";
import { listWorkspaceInvestigations } from "@/lib/investigation-repository";

export const dynamic = "force-dynamic";

export default async function Page({
  params,
}: {
  params: Promise<{ investigationId: string }>;
}) {
  const user = await requireWorkspaceUser();
  const { investigationId } = await params;
  const investigations = await listWorkspaceInvestigations(user.orgId);

  if (!investigations.some((item) => item.id === investigationId)) notFound();

  return (
    <InvestigationsScreen
      investigations={investigations}
      selectedInvestigationId={investigationId}
    />
  );
}
