import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { GenericProblemScreen } from "@/components/screens";
import { otherProblems } from "@/lib/seed";

export function generateStaticParams() { return otherProblems.map((problem) => ({ problemId: problem.id })); }

export default async function Page({ params }: { params: Promise<{ problemId: string }> }) {
  const { problemId } = await params;
  if (!otherProblems.some((problem) => problem.id === problemId)) notFound();
  return <AppShell section="Product problems"><GenericProblemScreen problemId={problemId}/></AppShell>;
}
