import { PddPrioritizationScreen } from "@/components/screens";
import { requireWorkspaceUser } from "@/lib/auth-user";
import { getEngineeringWorkflow } from "@/lib/engineering-workflow-repository";
import { listWorkspaceInvestigations } from "@/lib/investigation-repository";
import { getActiveConfirmedProblemRepositoryMatch } from "@/lib/problem-repository-match-repository";
import { getOverviewAnalytics } from "@/lib/overview-repository";
import { workspacePersistenceMode } from "@/lib/workspace-persistence";

export const dynamic = "force-dynamic";

export default async function Page() {
  const user = await requireWorkspaceUser();
  const [analytics, investigations] = await Promise.all([
    getOverviewAnalytics(user.orgId),
    listWorkspaceInvestigations(user.orgId),
  ]);
  const problems = analytics.problems.filter((problem) => problem.stage !== "Closed");
  const persistence = workspacePersistenceMode(user.orgId);
  const taskEntries = await Promise.all(
    problems.map(async (problem) => {
      const [workflow, repositoryMatch] = await Promise.all([
        getEngineeringWorkflow(user.orgId, problem.id),
        persistence === "postgres"
          ? getActiveConfirmedProblemRepositoryMatch(user.orgId, problem.id)
          : Promise.resolve(true),
      ]);
      return [problem.id, workflow, Boolean(repositoryMatch)] as const;
    }),
  );

  return (
    <PddPrioritizationScreen
      problems={structuredClone(problems)}
      investigations={structuredClone(investigations)}
      workflows={structuredClone(Object.fromEntries(taskEntries.map(([id, workflow]) => [id, workflow])))}
      repositoryReadyByProblem={Object.fromEntries(taskEntries.map(([id, , ready]) => [id, ready]))}
    />
  );
}
