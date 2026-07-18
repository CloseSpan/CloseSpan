import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { GenericProblemScreen } from "@/components/screens";
import { ORG_ID } from "@/lib/seed";
import { getWorkspaceData } from "@/lib/workspace-repository";

export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ problemId: string }> }) {
  const { problemId } = await params;
  const data = await getWorkspaceData(ORG_ID);
  const problem = data.analytics.problems.find((item) => item.id === problemId && item.id !== data.primaryProblem.id);
  if (!problem) notFound();
  return <AppShell section="Product problems"><GenericProblemScreen problem={problem}/></AppShell>;
}
