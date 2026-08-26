import pg from "pg";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: true } : undefined });
const expected = { organizations:1,product_problems:4,feedback_items:5,accounts:11,integrations:15,investigations:4,workspace_members:6,workspace_settings:1,prompt_versions:1 };
try {
  const providerConfigTable = await pool.query("SELECT to_regclass('public.ai_provider_configs') table_name");
  if (!providerConfigTable.rows[0].table_name) throw new Error("ai_provider_configs migration is missing");
  const requiredConnectorTables = [
    "pipedream_connections",
    "feature_requests",
    "feature_request_votes",
    "feature_request_rate_limits",
    "workspace_access_waitlist",
    "platform_user_activity",
  ];
  for (const table of requiredConnectorTables) {
    const relation = await pool.query("SELECT to_regclass($1) table_name", [
      `public.${table}`,
    ]);
    if (!relation.rows[0].table_name)
      throw new Error(`${table} migration is missing`);
  }
  const connectorColumns = await pool.query(
    `SELECT table_name,column_name FROM information_schema.columns
      WHERE table_schema='public' AND (
        (table_name='feedback_items' AND column_name='source_namespace') OR
        (table_name='pipedream_connections' AND column_name='external_user_id') OR
        (table_name='pipedream_connections' AND column_name='last_import_at')
      )`,
  );
  if (connectorColumns.rowCount !== 3)
    throw new Error("Pipedream connector migration is missing");
  for (const [table,count] of Object.entries(expected)) {
    const result = await pool.query(`SELECT count(*)::int count FROM ${table} WHERE ${table === "organizations" ? "id" : "org_id"}='org_northstar'`);
    const valid = table === "feedback_items"
      ? result.rows[0].count >= count
      : result.rows[0].count === count;
    if (!valid) throw new Error(`${table}: expected ${table === "feedback_items" ? "at least " : ""}${count}, received ${result.rows[0].count}`);
  }
  const impacts = await pool.query(`SELECT p.id,sum(a.arr)::int revenue,count(a.id)::int accounts FROM product_problems p
    JOIN problem_account_impacts i ON i.org_id=p.org_id AND i.problem_id=p.id JOIN accounts a ON a.org_id=i.org_id AND a.id=i.account_id
    WHERE p.org_id='org_northstar' GROUP BY p.id ORDER BY p.id`);
  if (impacts.rowCount !== 4) throw new Error("Every seeded problem must have affected-account records");
  const total = impacts.rows.reduce((sum,row) => sum + row.revenue,0);
  if (total !== 1_320_000) throw new Error(`Expected $1.32m affected ARR, received ${total}`);
  const prompt = await pool.query(`
    SELECT organization.id, count(prompt.id)::int AS active_count,
           min(prompt.provider) AS provider
      FROM organizations organization
      LEFT JOIN prompt_versions prompt
        ON prompt.org_id=organization.id
       AND prompt.name='feedback-intelligence'
       AND prompt.active=true
     GROUP BY organization.id
  `);
  if (prompt.rows.some((row) => row.active_count !== 1 || row.provider !== "multi-provider"))
    throw new Error("Every workspace must have exactly one active provider-agnostic feedback prompt");
  console.log("Database verification passed", {
    ...expected,
    ai_provider_configuration:"ready",
    pipedream_connect:"ready",
    affected_revenue:total,
  });
} finally { await pool.end(); }
