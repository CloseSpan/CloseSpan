import { randomUUID } from "node:crypto";
import process from "node:process";
import pg from "pg";
import {
  RegistryImageNotFoundError,
  SnapshotNotFoundError,
  TemplateBuildNotFoundError,
  TemplateNotFoundError,
  TenkiSandbox,
  VolumeNotFoundError,
  volumeIsDeletable,
} from "@tenkicloud/sandbox";
import { assertTrackedTemplateBuildCleanup } from "./tenki-template-build-provenance.mjs";

const apiKey = process.env.TENKI_API_KEY?.trim();
const databaseUrl = process.env.DATABASE_URL?.trim();
if (!apiKey) throw new Error("TENKI_API_KEY is required");
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const dryRun = process.argv.includes("--dry-run");
const purgeFailedCanaries = process.argv.includes("--purge-failed-canaries");
const graceDays = Number(process.env.TENKI_CATALOG_RETENTION_DAYS ?? 14);
const cacheRetentionDays = Number(process.env.TENKI_CACHE_RETENTION_DAYS ?? 30);
if (!Number.isSafeInteger(graceDays) || graceDays < 7 || graceDays > 365) {
  throw new Error("TENKI_CATALOG_RETENTION_DAYS must be between 7 and 365");
}
if (
  !Number.isSafeInteger(cacheRetentionDays)
  || cacheRetentionDays < 7
  || cacheRetentionDays > 365
) {
  throw new Error("TENKI_CACHE_RETENTION_DAYS must be between 7 and 365");
}

const pool = new pg.Pool({
  connectionString: databaseUrl,
  ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: true } : undefined,
});
const tenki = new TenkiSandbox({
  authToken: apiKey,
  timeoutMs: 60_000,
  dataPlaneReadyTimeoutMs: 60_000,
});

function artifactOwnershipTag(artifactId) {
  return `artifact-${artifactId.replaceAll("-", "").slice(0, 23)}`;
}

function cacheOwnershipTag(cacheId) {
  return `cache-${cacheId.replaceAll("-", "").slice(0, 26)}`;
}

async function hasReferences(artifact) {
  const digest = artifact.registry_digest_ref;
  if (!digest) return false;
  const result = await pool.query(
    `SELECT EXISTS(
       SELECT 1
         FROM execution_profile_assignments assignment
         JOIN execution_profile_versions profile
           ON profile.org_id=assignment.org_id
          AND profile.id=assignment.active_profile_id
        WHERE profile.config->>'tenkiImage'=$1
       UNION ALL
       SELECT 1 FROM pdd_prompt_verifications
        WHERE (
          status IN ('Queued','Generating tests')
          OR (
            status='Ready for approval'
            AND NOT EXISTS (
              SELECT 1 FROM approval_requests approval
               WHERE approval.org_id=pdd_prompt_verifications.org_id
                 AND approval.pdd_verification_id=pdd_prompt_verifications.id
                 AND approval.status IN ('Approved','Rejected','Superseded','Expired')
            )
          )
        )
          AND execution_profile_snapshot->'config'->>'tenkiImage'=$1
       UNION ALL
       SELECT 1 FROM approval_requests
        WHERE status='Pending' AND expires_at > now()
          AND execution_profile_snapshot->'config'->>'tenkiImage'=$1
       UNION ALL
       SELECT 1 FROM agent_runs
        WHERE status IN ('Queued','Running','Tests passed')
          AND execution_profile_snapshot->'config'->>'tenkiImage'=$1
     ) AS referenced`,
    [digest],
  );
  return Boolean(result.rows[0]?.referenced);
}

async function event(artifactId, type, detail) {
  await pool.query(
    `INSERT INTO tenki_environment_artifact_events(
       id,artifact_id,event_type,detail,actor_id
     ) VALUES($1,$2,$3,$4,'system:tenki-catalog-cleanup')`,
    [randomUUID(), artifactId, type, JSON.stringify(detail)],
  );
}

async function waitSnapshotDeleted(snapshotId) {
  const deadline = Date.now() + 3 * 60_000;
  while (Date.now() < deadline) {
    try {
      const snapshot = await tenki.getSnapshot(snapshotId);
      if (snapshot.state === "DELETED") return;
      if (snapshot.state !== "DELETING") {
        throw new Error(`Snapshot ${snapshotId} entered unexpected state ${snapshot.state}`);
      }
    } catch (error) {
      if (error instanceof SnapshotNotFoundError) return;
      throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  throw new Error(`Snapshot ${snapshotId} did not delete within the cleanup deadline`);
}

async function assertArtifactOwnership(artifact) {
  const expectedTag = artifactOwnershipTag(artifact.id);
  let trackedTemplate;
  if (artifact.template_id) {
    try {
      const template = await tenki.getTemplate(artifact.template_id);
      if (
        template.workspaceId !== artifact.tenki_workspace_id
        || !template.tags.includes(expectedTag)
      ) {
        throw new Error(`Template ${artifact.template_id} is not owned by ${expectedTag}`);
      }
      trackedTemplate = template;
    } catch (error) {
      if (!(error instanceof TemplateNotFoundError)) throw error;
    }
  }
  let trackedBuild;
  let resolvedSnapshotId = artifact.snapshot_id;
  let resolvedRegistryImageId = artifact.registry_image_id;
  if (artifact.build_id) {
    try {
      const build = await tenki.getTemplateBuild(artifact.build_id);
      const recovered = assertTrackedTemplateBuildCleanup({
        template: trackedTemplate,
        build,
        ownershipTag: expectedTag,
        expectedTemplateId: artifact.template_id,
        expectedWorkspaceId: artifact.tenki_workspace_id,
        expectedSnapshotId: artifact.snapshot_id,
        expectedRegistryImageId: artifact.registry_image_id,
      });
      resolvedSnapshotId = recovered.snapshotId;
      resolvedRegistryImageId = recovered.registryImageId;
      trackedBuild = build;
    } catch (error) {
      if (!(error instanceof TemplateBuildNotFoundError)) throw error;
    }
  }
  let registryImage;
  if (resolvedRegistryImageId) {
    try {
      const registry = await tenki.getRegistryImage(resolvedRegistryImageId, {
        workspaceId: artifact.tenki_workspace_id,
      });
      registryImage = registry.image;
      const linkedToTrackedSource = Boolean(
        registry.image
        && (
          registry.image.sourceTemplateId === artifact.template_id
          || registry.image.sourceSnapshotId === artifact.snapshot_id
        )
      );
      if (
        registry.image?.workspaceId !== artifact.tenki_workspace_id
        || (
          !registry.image.labels.includes(expectedTag)
          && !linkedToTrackedSource
        )
      ) {
        throw new Error(`Registry image ${resolvedRegistryImageId} is not owned by ${expectedTag}`);
      }
    } catch (error) {
      if (!(error instanceof RegistryImageNotFoundError)) throw error;
    }
  }
  if (resolvedSnapshotId) {
    try {
      const snapshot = await tenki.getSnapshot(resolvedSnapshotId);
      const linkedToTrackedBuilder = Boolean(
        artifact.builder_session_id
        && snapshot.sessionId === artifact.builder_session_id
      );
      const linkedToTrackedBuild = trackedBuild?.snapshotId === snapshot.id;
      const linkedToTrackedRegistry = registryImage?.sourceSnapshotId === snapshot.id;
      if (
        snapshot.workspaceId !== artifact.tenki_workspace_id
        || (
          !snapshot.tags.includes(expectedTag)
          && !linkedToTrackedBuilder
          && !linkedToTrackedBuild
          && !linkedToTrackedRegistry
        )
      ) {
        throw new Error(`Snapshot ${resolvedSnapshotId} is not owned by ${expectedTag}`);
      }
    } catch (error) {
      if (!(error instanceof SnapshotNotFoundError)) throw error;
    }
  }
  return {
    registryImageId: resolvedRegistryImageId,
    snapshotId: resolvedSnapshotId,
  };
}

async function waitVolumeDeleted(volumeId) {
  const deadline = Date.now() + 3 * 60_000;
  while (Date.now() < deadline) {
    try {
      const volume = await tenki.getVolume(volumeId);
      if (volume.state === "DELETED") return;
      if (volume.state !== "DELETING") {
        throw new Error(`Volume ${volumeId} entered unexpected state ${volume.state}`);
      }
    } catch (error) {
      if (error instanceof VolumeNotFoundError) return;
      throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  throw new Error(`Volume ${volumeId} did not delete within the cleanup deadline`);
}

async function cleanupArtifact(artifact) {
  if (await hasReferences(artifact)) {
    console.log(JSON.stringify({
      event: "catalog-cleanup-retained",
      artifactId: artifact.id,
      reason: "referenced",
    }));
    return;
  }
  if (dryRun) {
    const resolved = await assertArtifactOwnership(artifact);
    console.log(JSON.stringify({
      event: "catalog-cleanup-dry-run",
      artifactId: artifact.id,
      hasRegistryImage: Boolean(resolved.registryImageId),
      hasSnapshot: Boolean(resolved.snapshotId),
    }));
    return;
  }

  const claimed = await pool.query(
      `UPDATE tenki_environment_artifacts
        SET status='deleting',approved=false,updated_at=now()
      WHERE id=$1 AND status IN ('ready','deprecated','failed')
    RETURNING id`,
    [artifact.id],
  );
  if (!claimed.rowCount) return;
  await event(artifact.id, "catalog.cleanup_started", {});
  try {
    const resolved = await assertArtifactOwnership(artifact);
    if (resolved.registryImageId) {
      try {
        await tenki.deleteRegistryImage(
          resolved.registryImageId,
          "CloseSpan retention elapsed and no immutable workflow references remain",
        );
      } catch (error) {
        if (!(error instanceof RegistryImageNotFoundError)) throw error;
      }
    }
    if (artifact.template_id) {
      try {
        await tenki.deleteTemplate(artifact.template_id);
      } catch (error) {
        if (!(error instanceof TemplateNotFoundError)) throw error;
      }
    }
    if (resolved.snapshotId) {
      try {
        await tenki.deleteSnapshot(resolved.snapshotId);
        await waitSnapshotDeleted(resolved.snapshotId);
      } catch (error) {
        if (!(error instanceof SnapshotNotFoundError)) throw error;
      }
    }
    await pool.query(
      `UPDATE tenki_environment_artifacts
          SET status='deleted',approved=false,updated_at=now()
        WHERE id=$1 AND status='deleting'`,
      [artifact.id],
    );
    await event(artifact.id, "catalog.cleanup_completed", {});
    console.log(JSON.stringify({
      event: "catalog-cleanup-completed",
      artifactId: artifact.id,
    }));
  } catch (error) {
    await pool.query(
      `UPDATE tenki_environment_artifacts
          SET status='failed',approved=false,failure_reason=$2,updated_at=now()
        WHERE id=$1 AND status='deleting'`,
      [artifact.id, error instanceof Error ? error.message.slice(0, 4_000) : "Unknown cleanup failure"],
    );
    await event(artifact.id, "catalog.cleanup_failed", {
      message: error instanceof Error ? error.message : "Unknown cleanup failure",
    });
    throw error;
  }
}

async function cleanupCacheVolume(cache) {
  if (dryRun) {
    console.log(JSON.stringify({
      event: "cache-cleanup-dry-run",
      cacheId: cache.id,
      volumeId: cache.tenki_volume_id,
      state: cache.state,
    }));
    return;
  }
  if (cache.tenki_volume_id) {
    try {
      const volume = await tenki.getVolume(cache.tenki_volume_id);
      if (
        volume.workspaceId !== cache.tenki_workspace_id
        || !volume.tags.includes("closespan")
        || !volume.tags.includes("dependency-cache")
        || !volume.tags.includes(cacheOwnershipTag(cache.id))
      ) {
        throw new Error(`Volume ${cache.tenki_volume_id} is not a CloseSpan dependency cache`);
      }
      if (!volumeIsDeletable(volume)) {
        console.log(JSON.stringify({
          event: "cache-cleanup-deferred",
          cacheId: cache.id,
          reason: "volume-in-use",
        }));
        return;
      }
    } catch (error) {
      if (!(error instanceof VolumeNotFoundError)) throw error;
    }
  }
  const claimed = await pool.query(
    `UPDATE tenki_dependency_cache_volumes
        SET state='deleting',failure_reason=NULL
      WHERE id=$1 AND state IN ('available','failed')
    RETURNING id`,
    [cache.id],
  );
  if (!claimed.rowCount) return;
  try {
    if (cache.tenki_volume_id) {
      try {
        await tenki.deleteVolume(cache.tenki_volume_id);
        await waitVolumeDeleted(cache.tenki_volume_id);
      } catch (error) {
        if (!(error instanceof VolumeNotFoundError)) throw error;
      }
    }
    await pool.query(
      `UPDATE tenki_dependency_cache_volumes
          SET state='deleted',tenki_volume_id=NULL,failure_reason=NULL,
              owner_token=NULL
        WHERE id=$1 AND state='deleting'`,
      [cache.id],
    );
    console.log(JSON.stringify({
      event: "cache-cleanup-completed",
      cacheId: cache.id,
    }));
  } catch (error) {
    await pool.query(
      `UPDATE tenki_dependency_cache_volumes
          SET state='failed',failure_reason=$2
        WHERE id=$1 AND state='deleting'`,
      [
        cache.id,
        error instanceof Error
          ? error.message.slice(0, 4_000)
          : "Unknown cache cleanup failure",
      ],
    );
    throw error;
  }
}

function providerRefs(entry) {
  if (
    entry.provider_refs
    && typeof entry.provider_refs === "object"
    && !Array.isArray(entry.provider_refs)
  ) return entry.provider_refs;
  return {};
}

async function processExternalCleanup(entry) {
  if (dryRun) {
    console.log(JSON.stringify({
      event: "external-cleanup-dry-run",
      outboxId: entry.id,
      sourceKind: entry.source_kind,
    }));
    return;
  }
  const claimed = await pool.query(
    `UPDATE tenki_external_cleanup_outbox
        SET state='processing',attempts=attempts+1,updated_at=now()
      WHERE id=$1 AND state IN ('pending','failed')
        AND next_attempt_at <= now()
    RETURNING attempts`,
    [entry.id],
  );
  if (claimed.rowCount !== 1) return;
  const refs = providerRefs(entry);
  try {
    if (entry.source_kind === "cache") {
      if (typeof refs.volumeId === "string") {
        try {
          const volume = await tenki.getVolume(refs.volumeId);
          if (
            volume.workspaceId !== entry.tenki_workspace_id
            || !volume.tags.includes("closespan")
            || !volume.tags.includes(entry.ownership_token)
            || !volumeIsDeletable(volume)
          ) {
            throw new Error(`External cache ${refs.volumeId} is not safely deletable`);
          }
          await tenki.deleteVolume(refs.volumeId);
          await waitVolumeDeleted(refs.volumeId);
        } catch (error) {
          if (!(error instanceof VolumeNotFoundError)) throw error;
        }
      }
    } else {
      let trackedBuild;
      if (typeof refs.buildId === "string") {
        try {
          const build = await tenki.getTemplateBuild(refs.buildId);
          if (
            build.templateId !== refs.templateId
            || build.snapshotId !== refs.snapshotId
            || build.image?.id !== refs.registryImageId
            || build.image.workspaceId !== entry.tenki_workspace_id
          ) throw new Error("External template build ownership check failed");
          trackedBuild = build;
        } catch (error) {
          if (!(error instanceof TemplateBuildNotFoundError)) throw error;
        }
      }
      if (typeof refs.registryImageId === "string") {
        try {
          const registry = await tenki.getRegistryImage(refs.registryImageId, {
            workspaceId: entry.tenki_workspace_id,
          });
          if (
            registry.image?.workspaceId !== entry.tenki_workspace_id
            || (
              !registry.image.labels.includes(entry.ownership_token)
              && trackedBuild?.image?.id !== registry.image.id
            )
          ) throw new Error("External registry image ownership check failed");
          await tenki.deleteRegistryImage(
            refs.registryImageId,
            "CloseSpan tenant/resource deletion cleanup",
          );
        } catch (error) {
          if (!(error instanceof RegistryImageNotFoundError)) throw error;
        }
      }
      if (typeof refs.templateId === "string") {
        try {
          const template = await tenki.getTemplate(refs.templateId);
          if (
            template.workspaceId !== entry.tenki_workspace_id
            || !template.tags.includes(entry.ownership_token)
          ) throw new Error("External template ownership check failed");
          await tenki.deleteTemplate(refs.templateId);
        } catch (error) {
          if (!(error instanceof TemplateNotFoundError)) throw error;
        }
      }
      if (typeof refs.snapshotId === "string") {
        try {
          const snapshot = await tenki.getSnapshot(refs.snapshotId);
          if (
            snapshot.workspaceId !== entry.tenki_workspace_id
            || (
              !snapshot.tags.includes(entry.ownership_token)
              && trackedBuild?.snapshotId !== snapshot.id
              && !(
                typeof refs.builderSessionId === "string"
                && snapshot.sessionId === refs.builderSessionId
              )
            )
          ) throw new Error("External snapshot ownership check failed");
          await tenki.deleteSnapshot(refs.snapshotId);
          await waitSnapshotDeleted(refs.snapshotId);
        } catch (error) {
          if (!(error instanceof SnapshotNotFoundError)) throw error;
        }
      }
    }
    await pool.query(
      `UPDATE tenki_external_cleanup_outbox
          SET state='completed',failure_reason=NULL,completed_at=now(),
              updated_at=now()
        WHERE id=$1 AND state='processing'`,
      [entry.id],
    );
  } catch (error) {
    await pool.query(
      `UPDATE tenki_external_cleanup_outbox
          SET state='failed',failure_reason=$2,
              next_attempt_at=now() + make_interval(
                mins => LEAST(360,POWER(2,LEAST(attempts,8))::integer)
              ),updated_at=now()
        WHERE id=$1 AND state='processing'`,
      [
        entry.id,
        error instanceof Error
          ? error.message.slice(0, 4_000)
          : "Unknown external cleanup failure",
      ],
    );
    throw error;
  }
}

try {
  const failures = [];
  if (!dryRun) {
    await pool.query(
      `UPDATE tenki_external_cleanup_outbox
          SET state='failed',failure_reason=COALESCE(
                failure_reason,
                'Lifecycle recovery resumed an interrupted external cleanup'
              ),next_attempt_at=now(),updated_at=now()
        WHERE state='processing'
          AND updated_at < now() - interval '30 minutes'`,
    );
  }
  const externalCleanup = await pool.query(
    `SELECT id,source_kind,tenki_workspace_id,ownership_token,provider_refs
       FROM tenki_external_cleanup_outbox
      WHERE state IN ('pending','failed') AND next_attempt_at <= now()
      ORDER BY created_at
      LIMIT 50`,
  );
  for (const entry of externalCleanup.rows) {
    try {
      await processExternalCleanup(entry);
    } catch (error) {
      failures.push({
        kind: "external",
        id: entry.id,
        message: error instanceof Error ? error.message : "Unknown external cleanup failure",
      });
    }
  }
  if (!dryRun) {
    await pool.query(
      `UPDATE tenki_environment_artifacts
          SET status='failed',approved=false,
              failure_reason=COALESCE(failure_reason,'Lifecycle recovery found a stale build')
        WHERE status='building' AND updated_at < now() - interval '2 hours'`,
    );
    await pool.query(
      `UPDATE tenki_environment_artifacts
          SET status='failed',approved=false,
              failure_reason=COALESCE(failure_reason,'Lifecycle recovery resumed an interrupted deletion')
        WHERE status='deleting' AND updated_at < now() - interval '30 minutes'`,
    );
  }
  const candidates = await pool.query(
    `SELECT id,status,scope_type,tenki_workspace_id,template_id,build_id,
            builder_session_id,snapshot_id,registry_image_id,
            registry_digest_ref
      FROM tenki_environment_artifacts
      WHERE status IN ('ready','deprecated','failed')
        AND (
          updated_at < now() - ($1::text || ' days')::interval
          OR (status='failed' AND $2::boolean)
        )
      ORDER BY updated_at
      LIMIT 50`,
    [String(graceDays), purgeFailedCanaries],
  );
  for (const artifact of candidates.rows) {
    try {
      await cleanupArtifact(artifact);
    } catch (error) {
      failures.push({
        kind: "artifact",
        id: artifact.id,
        message: error instanceof Error ? error.message : "Unknown artifact cleanup failure",
      });
    }
  }

  const staleLeases = await pool.query(
    `SELECT id,tenki_volume_id,state,lease_run_id::text,owner_token::text
       FROM tenki_dependency_cache_volumes
      WHERE (state='leased' AND lease_expires_at < now())
         OR (state='provisioning' AND updated_at < now() - interval '30 minutes')
    `,
  );
  let recoveredLeases = 0;
  for (const stale of staleLeases.rows) {
    if (dryRun) continue;
    let attached = false;
    let missing = false;
    let remotelyAvailable = true;
    if (stale.tenki_volume_id) {
      try {
        const volume = await tenki.getVolume(stale.tenki_volume_id);
        attached = Boolean(volume.activeAttachments?.length);
        remotelyAvailable = volume.state === "AVAILABLE";
      } catch (error) {
        if (error instanceof VolumeNotFoundError) {
          missing = true;
          remotelyAvailable = false;
        } else {
          failures.push({ kind: "cache", id: stale.id, message: String(error) });
          continue;
        }
      }
    }
    if (attached) continue;
    if (missing || !remotelyAvailable) {
      const retired = await pool.query(
        `UPDATE tenki_dependency_cache_volumes
            SET state='deleted',tenki_volume_id=NULL,
                lease_run_id=NULL,lease_expires_at=NULL,owner_token=NULL,
                failure_reason=CASE WHEN $4::boolean
                  THEN 'Remote dependency cache no longer exists'
                  ELSE 'Remote dependency cache is not available' END
          WHERE id=$1 AND state=$2
            AND owner_token IS NOT DISTINCT FROM $3::uuid`,
        [stale.id, stale.state, stale.owner_token, missing],
      );
      recoveredLeases += retired.rowCount ?? 0;
      continue;
    }
    const recovered = await pool.query(
      `UPDATE tenki_dependency_cache_volumes
          SET state=CASE WHEN tenki_volume_id IS NULL THEN 'failed' ELSE 'available' END,
              lease_run_id=NULL,lease_expires_at=NULL,owner_token=NULL,
              failure_reason=CASE WHEN tenki_volume_id IS NULL
                THEN 'Provisioning did not complete before the lifecycle sweep'
                ELSE failure_reason END
        WHERE id=$1 AND state=$2
          AND owner_token IS NOT DISTINCT FROM $3::uuid`,
      [stale.id, stale.state, stale.owner_token],
    );
    recoveredLeases += recovered.rowCount ?? 0;
  }
  console.log(JSON.stringify({
    event: "cache-stale-leases-recovered",
    count: recoveredLeases,
    candidates: staleLeases.rowCount,
    dryRun,
  }));

  const cacheCandidates = await pool.query(
    `SELECT id,tenki_workspace_id,tenki_volume_id,state
       FROM tenki_dependency_cache_volumes
      WHERE (
        state='failed' AND updated_at < now() - ($1::text || ' days')::interval
      ) OR (
        state='available'
        AND COALESCE(last_used_at,created_at)
          < now() - ($2::text || ' days')::interval
      )
      ORDER BY updated_at
      LIMIT 50`,
    [String(graceDays), String(cacheRetentionDays)],
  );
  for (const cache of cacheCandidates.rows) {
    try {
      await cleanupCacheVolume(cache);
    } catch (error) {
      failures.push({
        kind: "cache",
        id: cache.id,
        message: error instanceof Error ? error.message : "Unknown cache cleanup failure",
      });
    }
  }
  if (failures.length) {
    throw new Error(`Tenki lifecycle cleanup completed with failures: ${JSON.stringify(failures)}`);
  }
} finally {
  tenki.close();
  await pool.end();
}

// @tenkicloud/sandbox 0.5.4 leaves RPC keepalive handles open after close().
process.exit(0);
