import { notFound } from "next/navigation";
import { AgentRunSummary } from "@/components/agent-run-summary";
import { requireWorkspaceUser } from "@/lib/auth-user";
import { getAgentRunById, listAgentRuns } from "@/lib/engineering-workflow-repository";
import { readPresentationDemo } from "@/lib/presentation-demo";

export const dynamic = "force-dynamic";

export default async function AgentRunPage({ params }: { params: Promise<{ runId: string }> }) {
  const user = await requireWorkspaceUser();
  const { runId } = await params;
  const result = await getAgentRunById(user.orgId, runId);
  if (!result) notFound();
  const [summaries, presentationDemo] = await Promise.all([listAgentRuns(user.orgId, runId), readPresentationDemo(user.orgId)]);
  const [summary] = summaries;

  return (
    <AgentRunSummary
      run={result.run}
      problemId={result.problemId}
      title={summary?.problemTitle ?? "Agent run"}
      isAdmin={user.role === "Admin"}
      presentationDemo={presentationDemo}
      finalExecutionStatus={summary?.finalExecutionStatus ?? null}
    />
  );
}
