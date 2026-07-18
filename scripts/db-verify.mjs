import pg from "pg";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: true } : undefined });
const expected = { organizations:1,product_problems:4,feedback_items:5,accounts:11,integrations:15,investigations:4,workspace_members:6,workspace_settings:1,prompt_versions:1 };
try {
  const providerConfigTable = await pool.query("SELECT to_regclass('public.ai_provider_configs') table_name");
  if (!providerConfigTable.rows[0].table_name) throw new Error("ai_provider_configs migration is missing");
  for (const [table,count] of Object.entries(expected)) {
    const result = await pool.query(`SELECT count(*)::int count FROM ${table} WHERE ${table === "organizations" ? "id" : "org_id"}='org_northstar'`);
    if (result.rows[0].count !== count) throw new Error(`${table}: expected ${count}, received ${result.rows[0].count}`);
  }
  const impacts = await pool.query(`SELECT p.id,sum(a.arr)::int revenue,count(a.id)::int accounts FROM product_problems p
    JOIN problem_account_impacts i ON i.org_id=p.org_id AND i.problem_id=p.id JOIN accounts a ON a.org_id=i.org_id AND a.id=i.account_id
    WHERE p.org_id='org_northstar' GROUP BY p.id ORDER BY p.id`);
  if (impacts.rowCount !== 4) throw new Error("Every seeded problem must have affected-account records");
  const total = impacts.rows.reduce((sum,row) => sum + row.revenue,0);
  if (total !== 1_320_000) throw new Error(`Expected $1.32m affected ARR, received ${total}`);
  const prompt = await pool.query("SELECT provider FROM prompt_versions WHERE org_id='org_northstar' AND name='feedback-intelligence' AND active=true");
  if (prompt.rows[0]?.provider !== "multi-provider") throw new Error("The active feedback prompt must be provider-agnostic");
  console.log("Database verification passed", { ...expected, ai_provider_configuration:"ready", affected_revenue:total });
} finally { await pool.end(); }
