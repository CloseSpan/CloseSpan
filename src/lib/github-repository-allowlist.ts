import { randomUUID } from "node:crypto";
import { databasePool, transaction } from "./db";
import { workspacePersistenceMode } from "./workspace-persistence";
import { HttpError } from "./request-security";

export interface GithubRepositoryAuthorization {
  id: string;
  installationId: string;
  repository: string;
  defaultBranch: string;
  active: boolean;
}

interface Actor {
  actorId: string;
  actorName: string;
  traceId: string;
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

export async function authorizeGithubRepository(
  orgId: string,
  input: { installationId?: unknown; repository?: unknown; defaultBranch?: unknown; active?: unknown },
  actor: Actor,
): Promise<GithubRepositoryAuthorization[]> {
  const installationId = typeof input.installationId === "string" ? input.installationId.trim() : String(input.installationId ?? "");
  const repository = typeof input.repository === "string" ? input.repository.trim() : "";
  const defaultBranch = typeof input.defaultBranch === "string" ? input.defaultBranch.trim() : "";
  const active = input.active !== false;
  if (!/^[1-9][0-9]{0,18}$/.test(installationId)) throw new HttpError(400, "A valid GitHub App installation ID is required");
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) throw new HttpError(400, "Repository must use owner/name format");
  if (!/^[A-Za-z0-9._/-]{1,255}$/.test(defaultBranch)) throw new HttpError(400, "A valid default branch is required");
  if (workspacePersistenceMode(orgId) === "memory") {
    const current = memoryAuthorizations.get(orgId) ?? [];
    const existing = current.find((item) => item.repository === repository);
    if (existing) Object.assign(existing, { installationId, defaultBranch, active });
    else current.push({ id: randomUUID(), installationId, repository, defaultBranch, active });
    memoryAuthorizations.set(orgId, current);
    return listGithubRepositoryAuthorizations(orgId);
  }
  await transaction(async (client) => {
    const id = randomUUID();
    await client.query(
      `INSERT INTO github_repository_allowlists(id,org_id,installation_id,repository,default_branch,active)
       VALUES($1,$2,$3,$4,$5,$6)
       ON CONFLICT(org_id,repository) DO UPDATE SET
         installation_id=excluded.installation_id,default_branch=excluded.default_branch,
         active=excluded.active,updated_at=now()`,
      [id, orgId, installationId, repository, defaultBranch, active],
    );
    await client.query(
      `INSERT INTO audit_events(id,org_id,actor_id,actor_name,action,entity_type,entity_id,trace_id)
       VALUES($1,$2,$3,$4,$5,'Integration',$6,$7)`,
      [randomUUID(), orgId, actor.actorId, actor.actorName, `${active ? "Authorized" : "Disabled"} GitHub repository ${repository} for agent runs`, repository, `${actor.traceId}_${randomUUID()}`],
    );
  });
  return listGithubRepositoryAuthorizations(orgId);
}
