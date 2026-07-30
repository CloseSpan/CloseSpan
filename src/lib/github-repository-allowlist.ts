import { databasePool } from "./db";
import { workspacePersistenceMode } from "./workspace-persistence";

export interface GithubRepositoryAuthorization {
  id: string;
  installationId: string;
  repository: string;
  defaultBranch: string;
  active: boolean;
}

const memoryAuthorizations = new Map<string, GithubRepositoryAuthorization[]>();

export async function listGithubRepositoryAuthorizations(orgId: string): Promise<GithubRepositoryAuthorization[]> {
  if (workspacePersistenceMode(orgId) === "memory") return structuredClone(memoryAuthorizations.get(orgId) ?? []);
  const result = await databasePool().query<{
    id: string; installation_id: string; repository: string; default_branch: string; active: boolean;
  }>(`SELECT id,installation_id::text,repository,default_branch,active
        FROM github_repository_allowlists WHERE org_id=$1 ORDER BY repository`, [orgId]);
  return result.rows.map((row) => ({ id: row.id, installationId: row.installation_id, repository: row.repository, defaultBranch: row.default_branch, active: row.active }));
}
