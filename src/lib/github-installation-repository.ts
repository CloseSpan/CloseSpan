import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { databasePool, transaction } from "./db";
import type { VerifiedGithubInstallation } from "./github-app-auth";
import { HttpError } from "./request-security";
import { requirePostgresWorkspace, workspacePersistenceMode } from "./workspace-persistence";

interface GithubActor {
  actorId: string;
  actorName: string;
  traceId: string;
}

export interface GithubAppInstallationRecord {
  id: string;
  installationId: string;
  accountLogin: string;
  accountType: string;
  repositorySelection: string;
  settingsUrl: string;
  active: boolean;
  lastSyncedAt: string;
}

export async function syncGithubInstallationRecords(
  client: PoolClient,
  orgId: string,
  installation: VerifiedGithubInstallation,
): Promise<void> {
  await client.query(
    `INSERT INTO github_app_installations(
       id,org_id,installation_id,account_id,account_login,account_type,
       repository_selection,settings_url,permissions,active,last_synced_at
     ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,true,now())
     ON CONFLICT(installation_id) DO UPDATE SET
       account_id=excluded.account_id,
       account_login=excluded.account_login,
       account_type=excluded.account_type,
       repository_selection=excluded.repository_selection,
       settings_url=excluded.settings_url,
       permissions=excluded.permissions,
       active=true,last_synced_at=now(),updated_at=now()`,
    [
      randomUUID(),
      orgId,
      installation.installationId,
      installation.accountId,
      installation.accountLogin,
      installation.accountType,
      installation.repositorySelection,
      installation.settingsUrl,
      JSON.stringify(installation.permissions),
    ],
  );

  const repositoryNames = installation.repositories.map((item) => item.repository);
  await client.query(
    `UPDATE github_repository_allowlists
        SET active=false,updated_at=now()
      WHERE org_id=$1 AND installation_id=$2
        AND NOT (repository=ANY($3::text[]))`,
    [orgId, installation.installationId, repositoryNames],
  );
  for (const repository of installation.repositories) {
    await client.query(
      `INSERT INTO github_repository_allowlists(
         id,org_id,installation_id,repository,default_branch,active
       ) VALUES($1,$2,$3,$4,$5,true)
       ON CONFLICT(org_id,repository) DO UPDATE SET
         installation_id=excluded.installation_id,
         default_branch=excluded.default_branch,
         active=true,updated_at=now()`,
      [
        randomUUID(),
        orgId,
        installation.installationId,
        repository.repository,
        repository.defaultBranch,
      ],
    );
  }

  await client.query(
    `UPDATE integrations
        SET connection_state='Connected',last_sync_at=now(),
            data_scope=$2,
            permissions='["metadata:read","contents:write","pull_requests:write:draft"]'::jsonb,
            error_message=NULL
      WHERE org_id=$1 AND id='int_github'`,
    [orgId, `${installation.repositories.length} explicitly authorized GitHub repositories`],
  );
}

export async function requireGithubInstallAttempt(
  attemptId: string,
  orgId: string,
  actorId: string,
): Promise<void> {
  requirePostgresWorkspace(orgId, "GitHub setup");
  const result = await databasePool().query(
    `SELECT 1 FROM github_app_install_attempts
      WHERE id=$1 AND org_id=$2 AND actor_id=$3
        AND consumed_at IS NULL AND expires_at>now()`,
    [attemptId, orgId, actorId],
  );
  if (result.rowCount !== 1)
    throw new HttpError(410, "GitHub installation request expired or was already used");
}

export async function connectGithubInstallation(
  attemptId: string,
  orgId: string,
  actor: GithubActor,
  installation: VerifiedGithubInstallation,
): Promise<{ repositoryCount: number }> {
  requirePostgresWorkspace(orgId, "GitHub setup");
  await transaction(async (client) => {
    const attempt = await client.query(
      `UPDATE github_app_install_attempts
          SET consumed_at=now()
        WHERE id=$1 AND org_id=$2 AND actor_id=$3
          AND consumed_at IS NULL AND expires_at>now()
        RETURNING id`,
      [attemptId, orgId, actor.actorId],
    );
    if (attempt.rowCount !== 1)
      throw new HttpError(410, "GitHub installation request expired or was already used");

    const existing = await client.query<{ org_id: string }>(
      `SELECT org_id FROM github_app_installations
        WHERE installation_id=$1 FOR UPDATE`,
      [installation.installationId],
    );
    if (existing.rows[0] && existing.rows[0].org_id !== orgId)
      throw new HttpError(409, "This GitHub installation is connected to another workspace");

    await syncGithubInstallationRecords(client, orgId, installation);
    await client.query(
      `INSERT INTO audit_events(
         id,org_id,actor_id,actor_name,action,entity_type,entity_id,trace_id
       ) VALUES($1,$2,$3,$4,$5,'Integration','int_github',$6)`,
      [
        randomUUID(),
        orgId,
        actor.actorId,
        actor.actorName,
        `Connected GitHub App installation ${installation.installationId} with ${installation.repositories.length} repositories`,
        `${actor.traceId}_${randomUUID()}`,
      ],
    );
  });
  return { repositoryCount: installation.repositories.length };
}

export async function listGithubAppInstallations(
  orgId: string,
): Promise<GithubAppInstallationRecord[]> {
  if (workspacePersistenceMode(orgId) !== "postgres") return [];
  const result = await databasePool().query<{
    id: string;
    installation_id: string;
    account_login: string;
    account_type: string;
    repository_selection: string;
    settings_url: string;
    active: boolean;
    last_synced_at: Date;
  }>(
    `SELECT id,installation_id::text,account_login,account_type,
            repository_selection,settings_url,active,last_synced_at
       FROM github_app_installations
      WHERE org_id=$1 ORDER BY active DESC,account_login`,
    [orgId],
  );
  return result.rows.map((row) => ({
    id: row.id,
    installationId: row.installation_id,
    accountLogin: row.account_login,
    accountType: row.account_type,
    repositorySelection: row.repository_selection,
    settingsUrl: row.settings_url,
    active: row.active,
    lastSyncedAt: row.last_synced_at.toISOString(),
  }));
}

export async function disconnectGithubInstallations(
  orgId: string,
  actor: GithubActor,
): Promise<void> {
  requirePostgresWorkspace(orgId, "GitHub setup");
  await transaction(async (client) => {
    await client.query(
      `UPDATE github_app_installations
          SET active=false,updated_at=now()
        WHERE org_id=$1 AND active=true`,
      [orgId],
    );
    await client.query(
      `UPDATE github_repository_allowlists
          SET active=false,updated_at=now()
        WHERE org_id=$1 AND active=true`,
      [orgId],
    );
    await client.query(
      `UPDATE integrations
          SET connection_state='Not connected',last_sync_at=now(),
              data_scope='None',permissions='[]'::jsonb,error_message=NULL
        WHERE org_id=$1 AND id='int_github'`,
      [orgId],
    );
    await client.query(
      `INSERT INTO audit_events(
         id,org_id,actor_id,actor_name,action,entity_type,entity_id,trace_id
       ) VALUES($1,$2,$3,$4,'Disconnected GitHub App installations','Integration','int_github',$5)`,
      [randomUUID(), orgId, actor.actorId, actor.actorName, `${actor.traceId}_${randomUUID()}`],
    );
  });
}
