import { notFound } from "next/navigation";
import { EngineeringTicketPanel } from "@/components/engineering-ticket-panel";
import { PddScreen } from "@/components/screens";
import { requireWorkspaceUser } from "@/lib/auth-user";
import { getEngineeringWorkflow } from "@/lib/engineering-workflow-repository";
import { listWorkspaceInvestigations } from "@/lib/investigation-repository";
import { readPddPromptTimingSummary } from "@/lib/pdd-prompt-timing-repository";
import { getActiveConfirmedProblemRepositoryMatch } from "@/lib/problem-repository-match-repository";
import { getOverviewAnalytics } from "@/lib/overview-repository";
import { readAutonomyLevel } from "@/lib/workspace-settings-repository";
import { workspacePersistenceMode } from "@/lib/workspace-persistence";

export const dynamic = "force-dynamic";

export default async function Page({
  params,
}: {
  params: Promise<{ problemId: string }>;
}) {
  const user = await requireWorkspaceUser();
  const { problemId } = await params;
  const [analytics, investigations, pddTiming, autonomyLevel] = await Promise.all([
    getOverviewAnalytics(user.orgId),
    listWorkspaceInvestigations(user.orgId),
    readPddPromptTimingSummary(user.orgId),
    readAutonomyLevel(user.orgId),
  ]);
  const problems = analytics.problems.filter((problem) => problem.stage !== "Closed");
  const selectedProblem = problems.find((problem) => problem.id === problemId);
  if (!selectedProblem) notFound();

  const [selectedWorkflow, confirmedRepositoryMatch] = await Promise.all([
    getEngineeringWorkflow(user.orgId, problemId),
    workspacePersistenceMode(user.orgId) === "postgres"
      ? getActiveConfirmedProblemRepositoryMatch(user.orgId, problemId)
      : Promise.resolve(true),
  ]);
  return (
    <PddScreen
      problems={structuredClone([selectedProblem])}
      investigations={structuredClone(investigations)}
      workflows={{ [problemId]: structuredClone(selectedWorkflow) }}
      selectedProblemId={problemId}
      engineeringPanel={
        <EngineeringTicketPanel
          orgId={user.orgId}
          problemId={problemId}
          initialWorkflow={structuredClone(selectedWorkflow)}
          autonomyLevel={autonomyLevel}
          initialRepositoryProfileReady={Boolean(confirmedRepositoryMatch)}
          initialPddTiming={structuredClone(pddTiming)}
        />
      }
    />
  );
}
