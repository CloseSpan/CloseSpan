import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { databasePool, transaction } from "./db";
import {
  parseGithubInstallationId,
  verifyGithubInstallation,
} from "./github-app-auth";
import { syncGithubInstallationRecords } from "./github-installation-repository";
import { normalizeMembershipEmail } from "./organization-repository";
import { HttpError, type RequestContext } from "./request-security";
import { requirePostgresWorkspace, workspacePersistenceMode } from "./workspace-persistence";

type ReuseContext = Pick<
  RequestContext,
  "orgId" | "actorId" | "actorName" | "actorEmail" | "role" | "traceId"
>;

export interface ReusableGithubInstallation {
  installationId: string;
  accountLogin: string;
  accountType: string;
  repositories: Array<{ repository: string; defaultBranch: string }>;
}

type Queryable = Pick<PoolClient, "query">;

interface EligibleInstallationRow {
  source_org_id: string;
  installation_id: string;
  account_id: string;
  account_login: string;
  account_type: string;
}

// Match the verified-identity normalization used by organization membership.
// In particular, Gmail aliases must not be treated as separate user accounts.
const normalizedSourceEmail = `CASE
  WHEN lower(split_part(btrim(member.email), '@', 2)) IN ('gmail.com','googlemail.com')
    THEN replace(lower(split_part(split_part(btrim(member.email), '@', 1), '+', 1)), '.', '')
  ELSE lower(split_part(btrim(member.email), '@', 1))
END || '@' || CASE
  WHEN lower(split_part(btrim(member.email), '@', 2))='googlemail.com' THEN 'gmail.com'
  ELSE lower(split_part(btrim(member.email), '@', 2))
END`;

async function requireCurrentAdmin(
  queryable: Queryable,
  context: ReuseContext,
  lock = false,
): Promise<string> {
  if (context.role !== "Admin") throw new HttpError(403, "Administrator permission is required");
  const result = await queryable.query<{ email: string }>(
    `SELECT email FROM workspace_members
      WHERE org_id=$1 AND id=$2 AND role='Admin'${lock ? " FOR SHARE" : ""}`,
    [context.orgId, context.actorId],
  );
  const email = result.rows[0]?.email;
  const authenticatedEmail = normalizeMembershipEmail(context.actorEmail);
  if (!email || !authenticatedEmail || normalizeMembershipEmail(email) !== authenticatedEmail) {
    throw new HttpError(403, "Administrator permission is required");
  }
  return authenticatedEmail;
}

async function eligibleInstallations(
  queryable: Queryable,
  context: ReuseContext,
  email: string,
  options: { installationId?: string; lock?: boolean } = {},
): Promise<EligibleInstallationRow[]> {
  const result = await queryable.query<EligibleInstallationRow>(
    `SELECT installation.org_id AS source_org_id,
            installation.installation_id::text, installation.account_id::text,
            installation.account_login, installation.account_type
       FROM github_app_installations AS installation
       JOIN workspace_members AS member ON member.org_id=installation.org_id
      WHERE installation.org_id<>$1
        AND installation.active=true AND installation.workspace_connected=true
        AND member.role='Admin' AND (${normalizedSourceEmail})=$2
        ${options.installationId ? "AND installation.installation_id=$3" : `AND NOT EXISTS (
          SELECT 1 FROM github_app_installations AS current_installation
           WHERE current_installation.org_id=$1
             AND current_installation.installation_id=installation.installation_id
             AND current_installation.active=true AND current_installation.workspace_connected=true
        )`}
      ORDER BY installation.account_login, installation.installation_id, installation.org_id
      ${options.lock ? "FOR SHARE OF installation, member" : ""}`,
    options.installationId
      ? [context.orgId, email, options.installationId]
      : [context.orgId, email],
  );
  return result.rows;
}

/** Discovery does not grant access, contact GitHub, or start repository work. */
export async function listReusableGithubInstallations(
  context: ReuseContext,
): Promise<ReusableGithubInstallation[]> {
  if (context.role !== "Admin") throw new HttpError(403, "Administrator permission is required");
  if (workspacePersistenceMode(context.orgId) !== "postgres") return [];
  const pool = databasePool();
  const email = await requireCurrentAdmin(pool, context);
  const eligible = await eligibleInstallations(pool, context, email);
  const installations = new Map<string, ReusableGithubInstallation>();
  for (const row of eligible) {
    if (installations.has(row.installation_id)) continue;
    // Recheck source access in the same statement that reads its repository names.
    const repositories = await pool.query<{ repository: string; default_branch: string }>(
      `SELECT DISTINCT ON (repository.repository) repository.repository, repository.default_branch
         FROM github_repository_allowlists AS repository
         JOIN github_app_installations AS installation
           ON installation.org_id=repository.org_id
          AND installation.installation_id=repository.installation_id
         JOIN workspace_members AS member ON member.org_id=installation.org_id
        WHERE installation.org_id<>$1 AND installation.installation_id=$3
          AND installation.active=true AND installation.workspace_connected=true
          AND repository.active=true
          AND member.role='Admin' AND (${normalizedSourceEmail})=$2
        ORDER BY repository.repository, installation.last_synced_at DESC`,
      [context.orgId, email, row.installation_id],
    );
    installations.set(row.installation_id, {
      installationId: row.installation_id,
      accountLogin: row.account_login,
      accountType: row.account_type,
      repositories: repositories.rows.map((repository) => ({
        repository: repository.repository,
        defaultBranch: repository.default_branch,
      })),
    });
  }
  return [...installations.values()];
}

/** Explicitly link an existing installation without inheriting another workspace's grants. */
export async function linkReusableGithubInstallation(
  context: ReuseContext,
  installationId: string,
): Promise<{ linked: true }> {
  requirePostgresWorkspace(context.orgId, "GitHub repository access");
  parseGithubInstallationId(installationId);
  const email = await requireCurrentAdmin(databasePool(), context);
  const eligible = await eligibleInstallations(databasePool(), context, email, { installationId });
  if (eligible.length === 0) throw new HttpError(404, "GitHub connection is no longer available");

  const installation = await verifyGithubInstallation(installationId);
  if (
    installation.installationId !== installationId ||
    !eligible.some((row) => row.account_id === installation.accountId)
  ) {
    throw new HttpError(409, "GitHub connection changed. Refresh and try again");
  }

  await transaction(async (client) => {
    const currentEmail = await requireCurrentAdmin(client, context, true);
    const currentEligible = await eligibleInstallations(client, context, currentEmail, {
      installationId,
      lock: true,
    });
    if (!currentEligible.some((row) => row.account_id === installation.accountId)) {
      throw new HttpError(404, "GitHub connection is no longer available");
    }
    await syncGithubInstallationRecords(client, context.orgId, installation, {
      preserveWorkspaceRepositoryBindings: true,
    });
    await client.query(
      `INSERT INTO audit_events(
         id,org_id,actor_id,actor_name,action,entity_type,entity_id,trace_id
       ) VALUES($1,$2,$3,$4,$5,'Integration','int_github',$6)`,
      [
        randomUUID(), context.orgId, context.actorId, context.actorName,
        `Linked existing GitHub installation ${installationId}; repository selection remains workspace-specific`,
        `${context.traceId}_${randomUUID()}`,
      ],
    );
  });
  return { linked: true };
}
