import fs from 'node:fs/promises';
import pg from 'pg';
if (process.env.VERCEL_ENV !== 'production') process.exit(0);
if (!process.env.DATABASE_URL) throw new Error('Production database configuration is required for migration 084');
const pool = new pg.Pool({connectionString:process.env.DATABASE_URL,ssl:process.env.DATABASE_SSL==='true'?{rejectUnauthorized:true}:undefined});
const client=await pool.connect();
try {
 await client.query('BEGIN');
 await client.query("SELECT pg_advisory_xact_lock(hashtextextended('closespan:schema-migrations',0))");
 const version='084_agent_run_findings.sql';
 const done=await client.query('SELECT 1 FROM schema_migrations WHERE version=$1',[version]);
 if(!done.rowCount){
  await client.query(await fs.readFile(`db/migrations/${version}`,'utf8'));
  await client.query('INSERT INTO schema_migrations(version) VALUES($1)',[version]);
 }
 await client.query('SELECT org_id,fingerprint,problem_id,evidence FROM agent_run_finding_issues LIMIT 0');
 await client.query('COMMIT');
 console.log('Migration 084 applied and table verified.');
} catch(error){await client.query('ROLLBACK');console.error('Migration failed:',error.code ?? error.name);process.exitCode=1;}
finally{client.release();await pool.end();}
