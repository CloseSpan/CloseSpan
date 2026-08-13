import { notFound, redirect } from "next/navigation";
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

  const investigation = investigations.find((item) => item.id === investigationId);
  if (!investigation) notFound();
  redirect(`/problems/${encodeURIComponent(investigation.problemId)}#investigation`);
}
