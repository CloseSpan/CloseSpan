import { databasePool } from "./db";
import { createGithubInstallationClient } from "./github-app-auth";
import { HttpError } from "./request-security";
import { workspacePersistenceMode } from "./workspace-persistence";

export interface GithubRepositoryAuthorization {
  id: string;
  installationId: string;
  repository: string;
  defaultBranch: string;
  executionBranch: string;
  workspaceSelected: boolean;
  active: boolean;
}

const memoryAuthorizations = new Map<string, GithubRepositoryAuthorization[]>();

export async function listGithubRepositoryAuthorizations(orgId: string): Promise<GithubRepositoryAuthorization[]> {
  if (workspacePersistenceMode(orgId) === "memory") return structuredClone(memoryAuthorizations.get(orgId) ?? []);
  const result = await databasePool().query<{
    id: string; installation_id: string; repository: string; default_branch: string;
    execution_branch: string;
    workspace_selected: boolean; active: boolean;
  }>(`SELECT id,installation_id::text,repository,default_branch,execution_branch,workspace_selected,active
        FROM github_repository_allowlists WHERE org_id=$1 ORDER BY repository`, [orgId]);
  return result.rows.map((row) => ({ id: row.id, installationId: row.installation_id, repository: row.repository, defaultBranch: row.default_branch, executionBranch: row.execution_branch, workspaceSelected: row.workspace_selected, active: row.active }));
}

export function normalizeGithubExecutionBranch(value: unknown): string {
  const branch = typeof value === "string" ? value.trim() : "";
  if (
    !branch
    || branch.length > 255
    || branch.startsWith("/")
    || branch.endsWith("/")
    || branch.includes("..")
    || branch.includes("@{")
    || /[\s~^:?*[\]\\\x00-\x1f\x7f]/.test(branch)
  ) throw new HttpError(400, "Choose a valid GitHub execution branch");
  return branch;
}

export async function updateGithubRepositoryExecutionBranch(input: {
  orgId: string;
  repository: string;
  executionBranch: unknown;
}): Promise<string> {
  const executionBranch = normalizeGithubExecutionBranch(input.executionBranch);
  const authorization = (await listGithubRepositoryAuthorizations(input.orgId)).find(
    (candidate) => candidate.repository === input.repository
      && candidate.active
      && candidate.workspaceSelected,
  );
  if (!authorization) throw new HttpError(409, "The repository is no longer authorized");
  const [owner, repo] = input.repository.split("/");
  const github = await createGithubInstallationClient(authorization.installationId);
  try {
    await github.rest.git.getRef({ owner, repo, ref: `heads/${executionBranch}` });
  } catch (error) {
    if (error && typeof error === "object" && "status" in error && error.status === 404) {
      throw new HttpError(400, `GitHub branch ${executionBranch} was not found`);
    }
    throw error;
  }
  await databasePool().query(
    `UPDATE github_repository_allowlists
        SET execution_branch=$3,updated_at=now()
      WHERE org_id=$1 AND repository=$2 AND active=true AND workspace_selected=true`,
    [input.orgId, input.repository, executionBranch],
  );
  return executionBranch;
}
