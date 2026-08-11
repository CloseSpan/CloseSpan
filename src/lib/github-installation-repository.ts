import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { databasePool, transaction } from "./db";
import {
  createGithubAppClient,
  parseGithubInstallationId,
  verifyGithubInstallation,
  type VerifiedGithubInstallation,
} from "./github-app-auth";
import { HttpError } from "./request-security";
import { requirePostgresWorkspace, workspacePersistenceMode } from "./workspace-persistence";

export interface GithubActor {
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

export interface GithubInstallationSyncOptions {
  preserveWorkspaceRepositoryBindings?: boolean;
  workspaceRepositories?: readonly string[];
}

interface GithubInstallationDeletionClient {
  rest: {
    apps: {
      deleteInstallation(input: { installation_id: number }): Promise<unknown>;
    };
  };
}

function githubErrorStatus(error: unknown): number | null {
  if (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    typeof error.status === "number"
  ) {
    return error.status;
  }
  return null;
}

export async function revokeGithubInstallationsForDeletedOrganization(
  orgId: string,
  dependencies: {
    createAppClient?: () => Promise<GithubInstallationDeletionClient>;
  } = {},
): Promise<void> {
  requirePostgresWorkspace(orgId, "GitHub organization deletion");
  const result = await databasePool().query<{
    installation_id: string;
    exclusive: boolean;
  }>(
    `SELECT DISTINCT installation.installation_id::text,
            NOT EXISTS (
              SELECT 1
                FROM github_app_installations AS other
               WHERE other.installation_id=installation.installation_id
                 AND other.org_id<>$1
                 AND other.workspace_connected=true
            ) AS exclusive
       FROM github_app_installations AS installation
      WHERE installation.org_id=$1`,
    [orgId],
  );

  const exclusiveInstallationIds = result.rows
    .filter((installation) => installation.exclusive)
    .map((installation) => installation.installation_id);
  if (exclusiveInstallationIds.length === 0) return;

  const client = await (dependencies.createAppClient ?? createGithubAppClient)();
  for (const installationId of exclusiveInstallationIds) {
    try {
      await client.rest.apps.deleteInstallation({
        installation_id: parseGithubInstallationId(installationId),
      });
    } catch (error) {
      // A missing installation is already fully revoked at GitHub.
      if (githubErrorStatus(error) !== 404) throw error;
    }
  }
}

export async function syncGithubInstallationRecords(
  client: PoolClient,
  orgId: string,
  installation: VerifiedGithubInstallation,
  options: GithubInstallationSyncOptions = {},
): Promise<void> {
  await client.query(
    `INSERT INTO github_app_installations(
       id,org_id,installation_id,account_id,account_login,account_type,
       repository_selection,settings_url,permissions,active,workspace_connected,last_synced_at
     ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,true,true,now())
     ON CONFLICT(org_id,installation_id) DO UPDATE SET
       account_id=excluded.account_id,
       account_login=excluded.account_login,
       account_type=excluded.account_type,
       repository_selection=excluded.repository_selection,
       settings_url=excluded.settings_url,
       permissions=excluded.permissions,
       active=true,workspace_connected=true,last_synced_at=now(),updated_at=now()`,
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
  if (options.preserveWorkspaceRepositoryBindings && options.workspaceRepositories) {
    throw new Error("Choose either preserved or explicit workspace repository bindings");
  }
  let repositoriesToBind = installation.repositories;
  if (options.workspaceRepositories) {
    const selectedNames = new Set(options.workspaceRepositories);
    repositoriesToBind = installation.repositories.filter((repository) =>
      selectedNames.has(repository.repository)
    );
    await client.query(
      `UPDATE github_repository_allowlists
          SET workspace_selected=false,active=false,updated_at=now()
        WHERE org_id=$1 AND installation_id=$2
          AND NOT (repository=ANY($3::text[]))`,
      [orgId, installation.installationId, [...selectedNames]],
    );
  } else if (options.preserveWorkspaceRepositoryBindings) {
    const selected = await client.query<{ repository: string }>(
      `SELECT repository FROM github_repository_allowlists
        WHERE org_id=$1 AND installation_id=$2 AND workspace_selected=true`,
      [orgId, installation.installationId],
    );
    const selectedNames = new Set(selected.rows.map((row) => row.repository));
    repositoriesToBind = installation.repositories.filter((repository) =>
      selectedNames.has(repository.repository)
    );
  }
  await client.query(
    `UPDATE github_repository_allowlists
        SET active=false,updated_at=now()
      WHERE org_id=$1 AND installation_id=$2
        AND NOT (repository=ANY($3::text[]))`,
    [orgId, installation.installationId, repositoryNames],
  );
  for (const repository of repositoriesToBind) {
    await client.query(
      `INSERT INTO github_repository_allowlists(
         id,org_id,installation_id,repository,default_branch,active,workspace_selected
       ) VALUES($1,$2,$3,$4,$5,true,true)
       ON CONFLICT(org_id,repository) DO UPDATE SET
         installation_id=excluded.installation_id,
         default_branch=excluded.default_branch,
         active=true,workspace_selected=true,updated_at=now()`,
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
    [orgId, `${repositoriesToBind.length} explicitly authorized GitHub repositories`],
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

export async function setGithubWorkspaceRepositoryBindings(
  orgId: string,
  installationId: string,
  repositories: readonly string[],
  actor: GithubActor,
  dependencies: {
    verifyInstallation?: typeof verifyGithubInstallation;
  } = {},
): Promise<{ repositoryCount: number }> {
  requirePostgresWorkspace(orgId, "GitHub repository access");
  if (repositories.length > 500) throw new HttpError(400, "Select no more than 500 repositories");
  const requested = [...new Set(repositories.map((repository) => repository.trim()))].sort();
  if (requested.some((repository) => !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository))) {
    throw new HttpError(400, "Every GitHub repository must use the owner/name format");
  }
  const connected = await databasePool().query(
    `SELECT 1 FROM github_app_installations
      WHERE org_id=$1 AND installation_id=$2
        AND workspace_connected=true AND active=true`,
    [orgId, installationId],
  );
  if (connected.rowCount !== 1) {
    throw new HttpError(404, "GitHub installation is not connected to this workspace");
  }
  const installation = await (dependencies.verifyInstallation ?? verifyGithubInstallation)(installationId);
  if (installation.installationId !== installationId) {
    throw new Error("Verified GitHub installation ID does not match the requested binding");
  }
  const accessible = new Set(installation.repositories.map((repository) => repository.repository));
  if (requested.some((repository) => !accessible.has(repository))) {
    throw new HttpError(409, "A selected repository is not accessible to this GitHub installation");
  }

  await transaction(async (client) => {
    const binding = await client.query(
      `SELECT 1 FROM github_app_installations
        WHERE org_id=$1 AND installation_id=$2
          AND workspace_connected=true AND active=true
        FOR UPDATE`,
      [orgId, installationId],
    );
    if (binding.rowCount !== 1) {
      throw new HttpError(404, "GitHub installation is not connected to this workspace");
    }
    await syncGithubInstallationRecords(client, orgId, installation, {
      workspaceRepositories: requested,
    });
    await client.query(
      `INSERT INTO audit_events(
         id,org_id,actor_id,actor_name,action,entity_type,entity_id,trace_id
       ) VALUES($1,$2,$3,$4,$5,'Integration','int_github',$6)`,
      [
        randomUUID(),
        orgId,
        actor.actorId,
        actor.actorName,
        `Selected ${requested.length} GitHub repositories for this workspace`,
        `${actor.traceId}_${randomUUID()}`,
      ],
    );
  });
  return { repositoryCount: requested.length };
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
          SET active=false,workspace_connected=false,updated_at=now()
        WHERE org_id=$1 AND workspace_connected=true`,
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
