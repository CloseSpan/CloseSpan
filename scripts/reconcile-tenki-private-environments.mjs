import { execFile } from "node:child_process";
import { promisify } from "node:util";
import process from "node:process";
import pg from "pg";

const run = promisify(execFile);
function argument(name) {
  return process.argv.find((value) => value.startsWith(`--${name}=`))
    ?.slice(name.length + 3)
    .trim() || null;
}
const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("DATABASE_URL is required");
const force = process.argv.includes("--force");
const limit = Number(process.env.TENKI_PRIVATE_BUILD_LIMIT ?? 3);
if (!Number.isSafeInteger(limit) || limit < 1 || limit > 20) {
  throw new Error("TENKI_PRIVATE_BUILD_LIMIT must be between 1 and 20");
}
const pool = new pg.Pool({
  connectionString: databaseUrl,
  ssl: process.env.DATABASE_SSL === "true"
    ? { rejectUnauthorized: true }
    : undefined,
});
const appOrigin = (
  argument("refresh-origin")
  ?? process.env.CLOSESPAN_INTERNAL_BASE_URL?.trim()
)?.replace(/\/$/, "");
const cronSecret = process.env.CRON_SECRET?.trim();

async function refreshDetection(target) {
  if (!appOrigin || !cronSecret) {
    console.log(JSON.stringify({
      event: "private-environment-refresh-deferred",
      orgId: target.org_id,
      repository: target.repository,
      reason: "internal-refresh-not-configured",
    }));
    return;
  }
  const response = await fetch(
    `${appOrigin}/api/internal/execution-profiles/refresh`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${cronSecret}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        orgId: target.org_id,
        repository: target.repository,
      }),
      signal: AbortSignal.timeout(4 * 60_000),
    },
  );
  if (!response.ok) {
    throw new Error(`Execution-profile refresh failed with HTTP ${response.status}`);
  }
}

try {
  const targets = await pool.query(
    `SELECT assignment.org_id,assignment.repository,assignment.workspace_root
       FROM execution_profile_assignments assignment
       JOIN execution_profile_versions profile
         ON profile.org_id=assignment.org_id
        AND profile.id=COALESCE(
          assignment.detected_profile_id,
          assignment.active_profile_id
        )
       JOIN github_repository_allowlists allowlist
         ON allowlist.org_id=assignment.org_id
        AND allowlist.repository=assignment.repository
        AND allowlist.active AND allowlist.workspace_selected
       JOIN LATERAL (
         SELECT artifact.id,artifact.registry_digest_ref
           FROM tenki_environment_artifacts artifact
          WHERE artifact.scope_type='managed_toolchain'
            AND artifact.runtime_family='node'
            AND artifact.status='active' AND artifact.approved
            AND artifact.validation_session_id IS NOT NULL
            AND artifact.registry_digest_ref IS NOT NULL
            AND (artifact.expires_at IS NULL OR artifact.expires_at > now() + interval '14 days')
            AND (
              COALESCE((profile.config->'runtimeTools'->>'browser')::boolean,false)=false
              OR artifact.capabilities ? 'browser'
            )
          ORDER BY artifact.version DESC
          LIMIT 1
       ) base ON true
      LEFT JOIN LATERAL (
        SELECT artifact.id,artifact.registry_digest_ref,artifact.expires_at,
               artifact.last_verified_at,artifact.template_spec
          FROM tenki_environment_artifacts artifact
         WHERE artifact.scope_type='repository_private'
           AND artifact.org_id=assignment.org_id
           AND artifact.repository=assignment.repository
           AND artifact.workspace_root=assignment.workspace_root
           AND artifact.status='active' AND artifact.approved
         ORDER BY artifact.version DESC
         LIMIT 1
      ) private ON true
      WHERE lower(profile.config->>'language') IN ('javascript','typescript')
        AND profile.config->>'packageManager' IN ('npm','pnpm')
        AND COALESCE((profile.config->>'automaticInstall')::boolean,false)
        AND profile.detection_evidence->>'dependencyFingerprint'
              ~ '^[a-f0-9]{64}$'
        AND profile.detection_evidence->>'sourceSha'
              ~ '^[a-f0-9]{40,64}$'
        AND (
          $2::boolean
          OR private.id IS NULL
          OR private.expires_at <= now() + interval '14 days'
          OR private.last_verified_at < now() - interval '12 hours'
          OR private.template_spec->>'baseArtifactId' IS DISTINCT FROM base.id::text
          OR private.template_spec->>'baseDigestRef' IS DISTINCT FROM base.registry_digest_ref
          OR private.template_spec->>'builderRelease' IS DISTINCT FROM 'private-node-v2'
          OR profile.config->>'tenkiImage' IS DISTINCT FROM private.registry_digest_ref
        )
      ORDER BY assignment.updated_at
      LIMIT $1`,
    [limit, force],
  );
  const failures = [];
  for (const target of targets.rows) {
    try {
      const result = await run(process.execPath, [
        "--env-file-if-exists=.env",
        "scripts/build-tenki-private-environment.mjs",
        `--org=${target.org_id}`,
        `--repository=${target.repository}`,
        `--root=${target.workspace_root}`,
        ...(force ? ["--force"] : []),
      ], {
        cwd: process.cwd(),
        env: process.env,
        maxBuffer: 2_000_000,
        timeout: 80 * 60_000,
      });
      if (result.stdout.trim()) process.stdout.write(result.stdout);
      if (result.stderr.trim()) process.stderr.write(result.stderr);
      await refreshDetection(target);
    } catch (error) {
      failures.push({
        orgId: target.org_id,
        repository: target.repository,
        workspaceRoot: target.workspace_root,
        message: error instanceof Error ? error.message : "Unknown private-build failure",
      });
    }
  }
  console.log(JSON.stringify({
    event: "private-environment-reconcile-completed",
    attempted: targets.rowCount,
    failures: failures.length,
  }));
  if (failures.length) {
    throw new Error(`Private environment reconciliation failed: ${JSON.stringify(failures)}`);
  }
} finally {
  await pool.end();
}
