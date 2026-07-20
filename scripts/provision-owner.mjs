import { createHash } from "node:crypto";
import pg from "pg";

const email = (process.env.PRODUCTION_OWNER_EMAIL ?? "").trim().toLowerCase();
const name = (process.env.PRODUCTION_OWNER_NAME ?? "").trim() || email;
const orgId = (process.env.PRODUCTION_ORG_ID ?? "org_feelow").trim();
const orgName = (process.env.PRODUCTION_ORG_NAME ?? "Feelow AI").trim();
const workspaceId = `${orgId}_primary`;

if (!email || !email.includes("@")) {
  throw new Error("PRODUCTION_OWNER_EMAIL must be a verified Google account email");
}
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");

const memberId = `user_${createHash("sha256").update(email).digest("hex").slice(0, 16)}`;
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl:
    process.env.DATABASE_SSL === "true"
      ? { rejectUnauthorized: true }
      : undefined,
});

try {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO organizations(id, name)
       VALUES ($1, $2)
       ON CONFLICT (id) DO UPDATE SET name = excluded.name, updated_at = now()`,
      [orgId, orgName],
    );
    await client.query(
      `INSERT INTO workspaces(id, org_id, name, primary_problem_id, primary_approval_id, version)
       VALUES ($1, $2, $3, NULL, NULL, 1)
       ON CONFLICT (org_id) DO UPDATE
         SET name = excluded.name, updated_at = now()`,
      [workspaceId, orgId, orgName],
    );
    await client.query(
      `INSERT INTO workspace_settings(
         org_id, autonomy_level, pii_redaction, retention_days, priority_weights,
         monthly_model_budget, used_model_cost, hard_stop, plan_name, plan_price
       ) VALUES (
         $1, 'Observe', true, 365,
         '{"frequency":20,"severity":20,"revenue":20,"churnRisk":15,"customerTier":10,"strategicAlignment":5,"sla":5,"engineeringEffort":5}'::jsonb,
         0, 0, true, 'Production', 'Managed externally'
       )
       ON CONFLICT (org_id) DO UPDATE SET
         autonomy_level = excluded.autonomy_level,
         plan_name = excluded.plan_name,
         plan_price = excluded.plan_price,
         updated_at = now()`,
      [orgId],
    );
    await client.query(
      `DELETE FROM workspace_members
        WHERE lower(btrim(email)) = $1
          AND org_id <> $2`,
      [email, orgId],
    );
    await client.query(
      `INSERT INTO workspace_members(id, org_id, display_name, email, role, team)
       VALUES ($1, $2, $3, $4, 'Admin', 'Owners')
       ON CONFLICT (org_id, email) DO UPDATE SET
         display_name = excluded.display_name,
         role = excluded.role,
         team = excluded.team`,
      [memberId, orgId, name, email],
    );
    for (const entry of [
      ["int_webhook", "Custom webhook", "Custom", 0],
      ["int_zendesk", "Zendesk", "Feedback", 1],
      ["int_intercom", "Intercom", "Feedback", 2],
      ["int_slack", "Slack", "Feedback", 3],
      ["int_github", "GitHub", "Engineering", 8],
      ["int_linear", "Linear", "Engineering", 7],
      ["int_jira", "Jira", "Engineering", 6],
      ["int_sentry", "Sentry", "Observability", 11],
      ["int_posthog", "PostHog", "Analytics", 13],
    ]) {
      await client.query(
        `INSERT INTO integrations(
           id, org_id, provider, category, connection_state, data_scope, permissions, display_order
         ) VALUES ($1,$2,$3,$4,'Not connected','None','[]',$5)
         ON CONFLICT (org_id, id) DO NOTHING`,
        [entry[0], orgId, entry[1], entry[2], entry[3]],
      );
    }
    await client.query("COMMIT");
    console.log("Provisioned production owner", {
      orgId,
      orgName,
      email,
      name,
      role: "Admin",
    });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
} finally {
  await pool.end();
}
