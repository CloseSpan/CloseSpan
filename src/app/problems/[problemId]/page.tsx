import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { GenericProblemScreen } from "@/components/screens";
import { requireWorkspaceUser } from "@/lib/auth-user";
import { getWorkspaceData } from "@/lib/workspace-repository";

export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ problemId: string }> }) {
  const user = await requireWorkspaceUser();
  const { problemId } = await params;
  const data = await getWorkspaceData(user.orgId);
  const problem = data.analytics.problems.find((item) => item.id === problemId && item.id !== data.primaryProblem.id);
  if (!problem) notFound();
  return <AppShell section="Product problems" user={user}><GenericProblemScreen problem={problem}/></AppShell>;
}
