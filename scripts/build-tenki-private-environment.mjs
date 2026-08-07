import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import process from "node:process";
import { createAppAuth } from "@octokit/auth-app";
import pg from "pg";
import {
  GiB,
  RegistryImageNotFoundError,
  SnapshotNotDurableError,
  SnapshotNotFoundError,
  TenkiSandbox,
  VolumeNotFoundError,
  volumeIsDeletable,
} from "@tenkicloud/sandbox";
import {
  assertTrustedSnapshotPublication,
  snapshotPublicationLookupRef,
} from "./tenki-snapshot-publication-provenance.mjs";

function argument(name) {
  return process.argv.find((value) => value.startsWith(`--${name}=`))
    ?.slice(name.length + 3)
    .trim() || null;
}

const orgId = argument("org");
const repository = argument("repository");
const workspaceRoot = argument("root") ?? ".";
const force = process.argv.includes("--force");
const apiKey = process.env.TENKI_API_KEY?.trim();
const databaseUrl = process.env.DATABASE_URL?.trim();
if (!orgId) throw new Error("--org=<organization-id> is required");
if (!repository || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
  throw new Error("--repository=<owner/name> is required");
}
if (!workspaceRoot || workspaceRoot.startsWith("/") || /(^|\/)\.\.($|\/)/.test(workspaceRoot)) {
  throw new Error("--root must be a safe repository-relative directory");
}
if (!apiKey) throw new Error("TENKI_API_KEY is required");
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const pool = new pg.Pool({
  connectionString: databaseUrl,
  ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: true } : undefined,
});
const tenki = new TenkiSandbox({
  authToken: apiKey,
  timeoutMs: 60_000,
  dataPlaneReadyTimeoutMs: 60_000,
});
const cacheMount = "/home/tenki/.cache/closespan";
const repositoryPath = "/home/tenki/repo";
const scopedRepositoryPath = workspaceRoot === "."
  ? repositoryPath
  : `${repositoryPath}/${workspaceRoot}`;
const artifactLifetimeMs = 60 * 24 * 60 * 60_000;
const maxArchiveBytes = 100_000_000;
const maxDependencyContextBytes = 5_000_000;
const builderRelease = "private-node-v2";
const dependencySymlinkAudit = [
  "const fs=require('node:fs'),path=require('node:path');",
  "const root=path.resolve(process.argv[1]);",
  "if(!fs.statSync(root).isDirectory())throw new Error('node_modules is missing');",
  "const inside=(target)=>target===root||target.startsWith(root+path.sep);",
  "const walk=(dir)=>{for(const entry of fs.readdirSync(dir,{withFileTypes:true})){const item=path.join(dir,entry.name);const stat=fs.lstatSync(item);if(stat.isSymbolicLink()){const declared=path.resolve(path.dirname(item),fs.readlinkSync(item));let resolved=declared;try{resolved=fs.realpathSync.native(item)}catch{}if(!inside(declared)||!inside(resolved))throw new Error('unsafe dependency symlink: '+item+' -> '+resolved);}else if(stat.isDirectory())walk(item);}};",
  "walk(root);",
].join("");

function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'"'"'`)}'`;
}

function artifactOwnershipTag(artifactId) {
  return `artifact-${artifactId.replaceAll("-", "").slice(0, 23)}`;
}

function cacheOwnershipTag(cacheId) {
  return `cache-${cacheId.replaceAll("-", "").slice(0, 26)}`;
}

function runtimeFamily(config) {
  const language = String(config.language ?? "").toLowerCase();
  if (["javascript", "typescript"].includes(language)) return "node";
  if (language === "python") return "python";
  if (["java", "kotlin"].includes(language)) return "jvm";
  return language;
}

function cacheEnvironment(root = cacheMount) {
  return {
    CI: "true",
    XDG_CACHE_HOME: `${root}/xdg`,
    npm_config_cache: `${root}/npm`,
    pnpm_config_store_dir: `${root}/pnpm-store`,
    PIP_CACHE_DIR: `${root}/pip`,
    CARGO_HOME: `${root}/cargo`,
    GOMODCACHE: `${root}/go/pkg/mod`,
    GOCACHE: `${root}/go/build`,
    GRADLE_USER_HOME: `${root}/gradle`,
    BUNDLE_PATH: `${root}/bundle`,
    COMPOSER_CACHE_DIR: `${root}/composer`,
  };
}

function output(result) {
  return [result.stdout, result.stderr]
    .map((value) => new TextDecoder().decode(value).trim())
    .filter(Boolean)
    .join("\n")
    .slice(-8_000);
}

async function requireCommand(session, command, args, options = {}) {
  const result = await session.exec(command, {
    args,
    timeoutMs: 10 * 60_000,
    ...options,
  });
  if (result.status !== "SUCCEEDED" || result.exitCode !== 0) {
    throw new Error(
      `${command} failed (${result.status}, exit ${String(result.exitCode)}): ${output(result)}`,
    );
  }
  return result;
}

async function createReadySession(options) {
  const session = await tenki.create({ ...options, waitReady: false });
  try {
    await session.waitReady(60_000);
    return session;
  } catch (error) {
    await session.closeIfOpen().catch(() => undefined);
    throw error;
  }
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

async function publishDurableSnapshot(options) {
  const deadline = Date.now() + 3 * 60_000;
  while (true) {
    try {
      return await tenki.publishRegistryImage(options);
    } catch (error) {
      if (!(error instanceof SnapshotNotDurableError) || Date.now() >= deadline) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 3_000));
    }
  }
}

async function profileContext() {
  const result = await pool.query(
    `SELECT profile.config,profile.detection_evidence,allowlist.installation_id::text
       FROM execution_profile_assignments assignment
       JOIN execution_profile_versions profile
         ON profile.org_id=assignment.org_id
        AND profile.id=COALESCE(assignment.detected_profile_id,assignment.active_profile_id)
       JOIN github_repository_allowlists allowlist
         ON allowlist.org_id=assignment.org_id
        AND allowlist.repository=assignment.repository
        AND allowlist.active
      WHERE assignment.org_id=$1 AND assignment.repository=$2
        AND assignment.workspace_root=$3`,
    [orgId, repository, workspaceRoot],
  );
  if (!result.rows[0]) {
    throw new Error("Detect a repository execution profile before building its private environment");
  }
  const config = result.rows[0].config;
  const evidence = result.rows[0].detection_evidence ?? {};
  const dependencyFingerprint = evidence.dependencyFingerprint;
  const sourceSha = evidence.sourceSha;
  if (!/^[a-f0-9]{64}$/.test(dependencyFingerprint ?? "")) {
    throw new Error("Refresh repository detection to capture a dependency fingerprint");
  }
  if (!/^[a-f0-9]{40,64}$/.test(sourceSha ?? "")) {
    throw new Error("The detected repository commit is missing or invalid");
  }
  if (runtimeFamily(config) !== "node") {
    throw new Error("The first private environment builder supports Node repositories; other catalog families continue using reviewed toolchain images");
  }
  const packageManager = String(config.packageManager ?? "unknown");
  if (!["npm", "pnpm"].includes(packageManager)) {
    throw new Error(`Private dependency snapshots do not yet support ${packageManager}`);
  }
  const manifestPaths = Array.isArray(evidence.manifestPaths)
    ? evidence.manifestPaths.filter((value) =>
        typeof value === "string"
        && value.length <= 500
        && !value.startsWith("/")
        && !/(^|\/)\.\.($|\/)/.test(value))
    : [];
  if (manifestPaths.length === 0 || manifestPaths.length > 100) {
    throw new Error("Refresh repository detection to capture a bounded manifest set");
  }
  const relativeManifestNames = new Set(manifestPaths.map((value) =>
    workspaceRoot === "." ? value : value.replace(`${workspaceRoot}/`, "")));
  const hasCommittedNpmLockfile = relativeManifestNames.has("package-lock.json")
    || relativeManifestNames.has("npm-shrinkwrap.json");
  const installCommand = packageManager === "npm"
    ? "npm ci --ignore-scripts --no-audit --no-fund"
    : "pnpm install --frozen-lockfile --ignore-scripts";
  const prefetchCommand = packageManager === "npm" && !hasCommittedNpmLockfile
    ? [
        "npm install --package-lock-only --ignore-scripts --no-audit --no-fund",
        installCommand,
      ].join(" && ")
    : installCommand;
  if (packageManager === "pnpm" && !relativeManifestNames.has("pnpm-lock.yaml")) {
    throw new Error("The private pnpm environment builder requires a committed pnpm-lock.yaml");
  }
  return {
    config,
    dependencyFingerprint,
    sourceSha,
    installationId: result.rows[0].installation_id,
    packageManager,
    installCommand,
    prefetchCommand,
    generateNpmLockfile: packageManager === "npm" && !hasCommittedNpmLockfile,
    manifestPaths,
  };
}

function offlineInstallCommand(command, packageManager) {
  if (packageManager === "npm") return `${command} --offline`;
  if (packageManager === "pnpm") return `${command} --offline`;
  throw new Error(`No offline install contract is defined for ${packageManager}`);
}

async function githubInstallationToken(context) {
  const appId = process.env.GITHUB_APP_ID?.trim();
  const privateKey = process.env.GITHUB_APP_PRIVATE_KEY?.trim().replaceAll("\\n", "\n");
  if (!appId || !privateKey) {
    throw new Error("GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY are required");
  }
  const auth = createAppAuth({ appId, privateKey });
  const installation = await auth({
    type: "installation",
    installationId: Number(context.installationId),
  });
  return installation.token;
}

async function githubArchive(context, token) {
  const response = await fetch(
    `https://api.github.com/repos/${repository}/tarball/${context.sourceSha}`,
    {
      redirect: "follow",
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${token}`,
        "x-github-api-version": "2022-11-28",
        "user-agent": "CloseSpan-Tenki-Environment-Builder",
      },
      signal: AbortSignal.timeout(60_000),
    },
  );
  if (!response.ok || !response.body) {
    throw new Error(`GitHub archive download failed with HTTP ${response.status}`);
  }
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > maxArchiveBytes) throw new Error("Repository archive exceeds 100 MB");
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxArchiveBytes) {
      await reader.cancel();
      throw new Error("Repository archive exceeds 100 MB");
    }
    chunks.push(value);
  }
  const archive = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    archive.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return archive;
}

async function githubDependencyFiles(context, token) {
  const files = [];
  let total = 0;
  for (const manifestPath of context.manifestPaths) {
    const encodedPath = manifestPath.split("/").map(encodeURIComponent).join("/");
    const response = await fetch(
      `https://api.github.com/repos/${repository}/contents/${encodedPath}?ref=${encodeURIComponent(context.sourceSha)}`,
      {
        headers: {
          accept: "application/vnd.github.raw+json",
          authorization: `Bearer ${token}`,
          "x-github-api-version": "2022-11-28",
          "user-agent": "CloseSpan-Tenki-Environment-Builder",
        },
        signal: AbortSignal.timeout(30_000),
      },
    );
    if (!response.ok || !response.body) {
      throw new Error(`GitHub could not load detected dependency file ${manifestPath}`);
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    total += bytes.byteLength;
    if (total > maxDependencyContextBytes) {
      throw new Error("Detected dependency files exceed the 5 MB private-build limit");
    }
    const content = new TextDecoder().decode(bytes);
    if (/(?:"workspaces"\s*:|\bworkspace:|\bfile:|\blink:)/i.test(content)) {
      throw new Error(
        "Repository-local workspace dependencies require a reviewed custom environment and cannot use the generic private dependency builder",
      );
    }
    files.push({ path: manifestPath, bytes });
  }
  return files;
}

async function activeBase(context) {
  const browserRequired = Boolean(context.config.runtimeTools?.browser);
  const result = await pool.query(
    `SELECT id,tenki_workspace_id,registry_digest_ref,capabilities
       FROM tenki_environment_artifacts
      WHERE scope_type='managed_toolchain' AND status='active' AND approved
        AND runtime_family='node'
        AND registry_digest_ref IS NOT NULL
        AND (expires_at IS NULL OR expires_at > now())
        AND ($1::boolean=false OR capabilities ? 'browser')
      ORDER BY version DESC LIMIT 1`,
    [browserRequired],
  );
  if (!result.rows[0]) {
    throw new Error("Reconcile the trusted Node toolchain catalog before building a private environment");
  }
  return result.rows[0];
}

async function nextArtifactVersion(catalogKey) {
  const result = await pool.query(
    `SELECT COALESCE(MAX(version),0)::integer + 1 AS version
       FROM tenki_environment_artifacts
      WHERE scope_type='repository_private' AND org_id=$1
        AND repository=$2 AND workspace_root=$3 AND catalog_key=$4`,
    [orgId, repository, workspaceRoot, catalogKey],
  );
  return result.rows[0]?.version ?? 1;
}

async function acquireCache(context, base, artifactId) {
  const cacheKey = hash(JSON.stringify([
    orgId,
    repository,
    workspaceRoot,
    context.packageManager,
    context.dependencyFingerprint,
    base.registry_digest_ref,
  ]));
  const client = await pool.connect();
  let row;
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      `tenki-cache:${orgId}:${repository}:${workspaceRoot}:${cacheKey}`,
    ]);
    const existing = await client.query(
      `SELECT id,tenki_volume_id,state,owner_token::text,cache_key
         FROM tenki_dependency_cache_volumes
        WHERE org_id=$1 AND repository=$2 AND workspace_root=$3
          AND cache_key=$4 AND slot=1 FOR UPDATE`,
      [orgId, repository, workspaceRoot, cacheKey],
    );
    row = existing.rows[0];
    if (row?.state === "deleted") {
      const reset = await client.query(
        `UPDATE tenki_dependency_cache_volumes
            SET state='provisioning',owner_token=$2,failure_reason=NULL
          WHERE id=$1 AND state='deleted'
        RETURNING id,tenki_volume_id,state,owner_token::text`,
        [row.id, artifactId],
      );
      row = reset.rows[0];
    }
    if (!row) {
      row = {
        id: randomUUID(),
        tenki_volume_id: null,
        state: "provisioning",
        owner_token: artifactId,
      };
      await client.query(
        `INSERT INTO tenki_dependency_cache_volumes(
           id,org_id,repository,workspace_root,cache_key,slot,state,size_bytes,
           owner_token,tenki_workspace_id
         ) VALUES($1,$2,$3,$4,$5,1,'provisioning',$6,$7,$8)`,
        [
          row.id,
          orgId,
          repository,
          workspaceRoot,
          cacheKey,
          10 * GiB,
          artifactId,
          base.tenki_workspace_id,
        ],
      );
    }
    if (row.state === "leased") throw new Error("The repository dependency cache is already leased");
    if (row.state === "provisioning" && row.owner_token !== artifactId) {
      throw new Error("The repository dependency cache is being provisioned by another builder");
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  let volumeId = row.tenki_volume_id;
  const ownershipTag = cacheOwnershipTag(row.id);
  if (row.state === "failed") {
    const claimed = await pool.query(
      `UPDATE tenki_dependency_cache_volumes
          SET state='deleting'
        WHERE id=$1 AND state='failed' AND owner_token IS NULL
      RETURNING tenki_volume_id`,
      [row.id],
    );
    if (claimed.rowCount === 1) {
      const failedVolumeId = claimed.rows[0].tenki_volume_id;
      try {
        if (failedVolumeId) {
          const remote = await tenki.getVolume(failedVolumeId);
          if (
            remote.workspaceId !== base.tenki_workspace_id
            || !remote.tags.includes(ownershipTag)
          ) {
            throw new Error("Failed dependency cache did not match its unique ownership tag");
          }
          if (!volumeIsDeletable(remote)) {
            throw new Error("Failed dependency cache is still attached and cannot be rebuilt yet");
          }
          await tenki.deleteVolume(failedVolumeId);
          await waitVolumeDeleted(failedVolumeId);
        }
        await pool.query(
          `UPDATE tenki_dependency_cache_volumes
              SET state='deleted',tenki_volume_id=NULL,failure_reason=NULL
            WHERE id=$1 AND state='deleting'`,
          [row.id],
        );
      } catch (error) {
        if (error instanceof VolumeNotFoundError) {
          await pool.query(
            `UPDATE tenki_dependency_cache_volumes
                SET state='deleted',tenki_volume_id=NULL,failure_reason=NULL
              WHERE id=$1 AND state='deleting'`,
            [row.id],
          );
        } else {
          await pool.query(
            `UPDATE tenki_dependency_cache_volumes
                SET state='failed',failure_reason=$2
              WHERE id=$1 AND state='deleting'`,
            [
              row.id,
              error instanceof Error ? error.message.slice(0, 4_000) : "Cache recovery failed",
            ],
          );
          throw error;
        }
      }
      return acquireCache(context, base, artifactId);
    }
    throw new Error("The failed dependency cache is already being recovered");
  }
  if (volumeId && row.state === "available") {
    try {
      const remote = await tenki.getVolume(volumeId);
      if (
        remote.workspaceId !== base.tenki_workspace_id
        || !remote.tags.includes(ownershipTag)
      ) throw new Error("Dependency cache ownership validation failed");
      if (remote.state !== "AVAILABLE" || remote.activeAttachments?.length) {
        throw new Error("Dependency cache is not remotely available for an isolated lease");
      }
    } catch (error) {
      if (error instanceof VolumeNotFoundError) {
        await pool.query(
          `UPDATE tenki_dependency_cache_volumes
              SET state='deleted',tenki_volume_id=NULL,failure_reason=NULL
            WHERE id=$1 AND state='available' AND tenki_volume_id=$2`,
          [row.id, volumeId],
        );
        return acquireCache(context, base, artifactId);
      }
      throw error;
    }
  }
  if (!volumeId) {
    try {
      const volume = await tenki.createVolume({
        workspaceId: base.tenki_workspace_id,
        name: `closespan-cache-${cacheKey.slice(0, 12)}-${row.id.slice(0, 8)}`,
        sizeBytes: 10 * GiB,
      });
      volumeId = volume.id;
      const captured = await pool.query(
        `UPDATE tenki_dependency_cache_volumes
            SET tenki_volume_id=$2
          WHERE id=$1 AND state='provisioning' AND owner_token=$3
            AND tenki_volume_id IS NULL
        RETURNING id`,
        [row.id, volume.id, artifactId],
      );
      if (captured.rowCount !== 1) {
        await tenki.deleteVolume(volume.id).catch(() => undefined);
        throw new Error("Dependency-cache ownership changed before its provider ID was recorded");
      }
      const ready = await tenki.waitVolumeReady(volume.id, 5 * 60_000);
      volumeId = ready.id;
      await tenki.updateVolume(volumeId, {
        tags: [
          "closespan",
          "dependency-cache",
          ownershipTag,
          `org-${hash(orgId).slice(0, 12)}`,
          `repo-${hash(`${repository}:${workspaceRoot}`).slice(0, 12)}`,
        ],
      });
      const persisted = await pool.query(
        `UPDATE tenki_dependency_cache_volumes
            SET state='available',failure_reason=NULL,
                owner_token=NULL
          WHERE id=$1 AND tenki_volume_id=$2
            AND state='provisioning' AND owner_token=$3
        RETURNING id`,
        [row.id, volumeId, artifactId],
      );
      if (persisted.rowCount !== 1) {
        await tenki.deleteVolume(volumeId).catch(() => undefined);
        throw new Error("Dependency-cache ownership changed during provisioning");
      }
    } catch (error) {
      let providerDeleted = false;
      if (volumeId) {
        try {
          await tenki.deleteVolume(volumeId);
          await waitVolumeDeleted(volumeId);
          providerDeleted = true;
        } catch {
          providerDeleted = false;
        }
      }
      await pool.query(
        `UPDATE tenki_dependency_cache_volumes
            SET state='failed',failure_reason=$2,owner_token=NULL,
                tenki_volume_id=CASE WHEN $4::boolean THEN NULL ELSE tenki_volume_id END
          WHERE id=$1 AND state='provisioning' AND owner_token=$3`,
        [
          row.id,
          error instanceof Error ? error.message.slice(0, 4_000) : "Cache provisioning failed",
          artifactId,
          providerDeleted,
        ],
      );
      throw error;
    }
  }
  const leased = await pool.query(
      `UPDATE tenki_dependency_cache_volumes
        SET state='leased',lease_run_id=$2,
            owner_token=$2,
            lease_expires_at=now() + interval '90 minutes',last_used_at=now()
      WHERE id=$1 AND state='available' AND tenki_volume_id IS NOT NULL
        AND owner_token IS NULL
    RETURNING id`,
    [row.id, artifactId],
  );
  if (!leased.rowCount) throw new Error("The dependency cache could not be leased");
  return { id: row.id, volumeId, cacheKey, ownerToken: artifactId };
}

async function releaseCache(cache, failureReason = null) {
  const released = await pool.query(
    `UPDATE tenki_dependency_cache_volumes
        SET state=CASE WHEN $2::text IS NULL THEN 'available' ELSE 'failed' END,
            lease_run_id=NULL,lease_expires_at=NULL,owner_token=NULL,
            failure_reason=$2,last_used_at=now()
      WHERE id=$1 AND state='leased' AND lease_run_id=$3 AND owner_token=$3`,
    [
      cache.id,
      failureReason?.slice(0, 4_000) ?? null,
      cache.ownerToken,
    ],
  );
  if (released.rowCount !== 1) {
    throw new Error("Dependency-cache lease ownership changed before release");
  }
}

async function heartbeatCache(cache) {
  const heartbeat = await pool.query(
    `UPDATE tenki_dependency_cache_volumes
        SET lease_expires_at=now() + interval '90 minutes',last_used_at=now()
      WHERE id=$1 AND state='leased' AND lease_run_id=$2 AND owner_token=$2`,
    [cache.id, cache.ownerToken],
  );
  if (heartbeat.rowCount !== 1) {
    throw new Error("Dependency-cache lease was lost during the private build");
  }
}

async function prepareSession(session, archive) {
  await session.writeFile("/home/tenki/repository.tar.gz", archive);
  await requireCommand(session, "mkdir", ["-p", repositoryPath]);
  await requireCommand(session, "tar", [
    "-xzf",
    "/home/tenki/repository.tar.gz",
    "-C",
    repositoryPath,
    "--strip-components=1",
  ]);
  await session.remove("/home/tenki/repository.tar.gz");
}

async function prepareDependencyContext(session, files) {
  for (const file of files) {
    const target = `${repositoryPath}/${file.path}`;
    await requireCommand(session, "mkdir", ["-p", path.posix.dirname(target)]);
    await session.writeFile(target, file.bytes);
  }
}

function relativeManifestPath(filePath) {
  return workspaceRoot === "."
    ? filePath
    : filePath.replace(`${workspaceRoot}/`, "");
}

function resolvedLockfile(files, packageManager) {
  const accepted = packageManager === "npm"
    ? new Set(["package-lock.json", "npm-shrinkwrap.json"])
    : new Set(["pnpm-lock.yaml"]);
  const file = files.find((candidate) =>
    accepted.has(relativeManifestPath(candidate.path)));
  if (!file) return null;
  if (file.bytes.byteLength > maxDependencyContextBytes) {
    throw new Error("Resolved dependency lockfile exceeds the 5 MB private-build limit");
  }
  if (packageManager === "npm") {
    let document;
    try {
      document = JSON.parse(new TextDecoder().decode(file.bytes));
    } catch {
      throw new Error("Resolved npm lockfile is not valid JSON");
    }
    if (
      !Number.isInteger(document.lockfileVersion)
      || document.lockfileVersion < 2
      || typeof document.packages !== "object"
      || document.packages === null
    ) {
      throw new Error("Resolved npm lockfile is not suitable for deterministic npm ci");
    }
  }
  return {
    path: relativeManifestPath(file.path),
    bytes: file.bytes,
    hash: hash(file.bytes),
    source: "repository",
  };
}

async function prefetch(context, base, cache, dependencyFiles, artifactId) {
  let session;
  try {
    session = await createReadySession({
      name: `closespan-cache-prefetch-${artifactId.slice(0, 8)}`,
      workspaceId: base.tenki_workspace_id,
      image: base.registry_digest_ref,
      allowInbound: false,
      allowOutbound: true,
      cpuCores: 2,
      memoryMb: 4_096,
      diskSizeGb: 12,
      maxDurationMs: 15 * 60_000,
      idleTimeoutMinutes: 2,
      volumes: [{ volumeId: cache.volumeId, mountPath: cacheMount, readOnly: false }],
      tags: ["closespan", "dependency-cache", "prefetch"],
      metadata: { purpose: "closespan-dependency-cache-prefetch", artifactId },
    });
    if (
      session.inboundEnabled
      || !session.outboundEnabled
      || session.workspaceId !== base.tenki_workspace_id
      || session.sourceRegistryRef !== base.registry_digest_ref
    ) {
      throw new Error("Dependency prefetch networking did not match policy");
    }
    await prepareDependencyContext(session, dependencyFiles);
    await requireCommand(session, "bash", ["-lc", [
      `cd ${shellQuote(scopedRepositoryPath)}`,
      context.prefetchCommand,
    ].join(" && ")], {
      env: cacheEnvironment(),
    });
    if (context.generateNpmLockfile) {
      const bytes = await session.readFile(`${scopedRepositoryPath}/package-lock.json`);
      return {
        ...resolvedLockfile([{
          path: `${workspaceRoot === "." ? "" : `${workspaceRoot}/`}package-lock.json`,
          bytes,
        }], "npm"),
        source: "generated",
      };
    }
    return null;
  } finally {
    if (session) {
      await session.detachVolume(cache.volumeId, {
        force: false,
        waitTimeoutMs: 60_000,
      }).catch(() => undefined);
      await session.closeIfOpen().catch(() => undefined);
      await tenki.waitVolumeReady(cache.volumeId, 3 * 60_000);
    }
  }
}

async function assemble(
  context,
  base,
  cache,
  archive,
  resolvedDependencyLock,
  artifactId,
  catalogKey,
  version,
) {
  let session;
  try {
    session = await createReadySession({
      name: `closespan-private-builder-${artifactId.slice(0, 8)}`,
      workspaceId: base.tenki_workspace_id,
      image: base.registry_digest_ref,
      allowInbound: false,
      allowOutbound: false,
      cpuCores: 2,
      memoryMb: 4_096,
      diskSizeGb: 20,
      maxDurationMs: 20 * 60_000,
      idleTimeoutMinutes: 2,
      volumes: [{ volumeId: cache.volumeId, mountPath: cacheMount, readOnly: true }],
      tags: ["closespan", "private-environment", "builder"],
      metadata: { purpose: "closespan-private-environment-builder", artifactId },
    });
    if (
      session.inboundEnabled
      || session.outboundEnabled
      || session.workspaceId !== base.tenki_workspace_id
      || session.sourceRegistryRef !== base.registry_digest_ref
    ) {
      throw new Error("Private environment builder was not network isolated");
    }
    await prepareSession(session, archive);
    if (resolvedDependencyLock.source === "generated") {
      await session.writeFile(
        `${scopedRepositoryPath}/${resolvedDependencyLock.path}`,
        resolvedDependencyLock.bytes,
      );
    }
    const assemblyCache = "/home/tenki/.cache/closespan-assembly";
    const packageCacheDirectory = context.packageManager === "npm"
      ? "npm"
      : "pnpm-store";
    await requireCommand(session, "bash", ["-lc", [
      "set -eu",
      `mkdir -p ${assemblyCache}/${packageCacheDirectory}`,
      `cp -a ${cacheMount}/${packageCacheDirectory}/. ${assemblyCache}/${packageCacheDirectory}/`,
    ].join("; ")]);
    await requireCommand(session, "bash", [
      "-lc",
      `cd ${shellQuote(scopedRepositoryPath)} && ${offlineInstallCommand(context.installCommand, context.packageManager)}`,
    ], { env: cacheEnvironment(assemblyCache) });
    await requireCommand(session, "mkdir", [
      "-p",
      `${scopedRepositoryPath}/node_modules`,
    ]);
    await requireCommand(session, "node", [
      "-e",
      dependencySymlinkAudit,
      `${scopedRepositoryPath}/node_modules`,
    ]);
    await requireCommand(session, "bash", ["-lc", [
      `cd ${shellQuote(scopedRepositoryPath)}`,
      "sudo install -d -o \"$(id -u)\" -g \"$(id -g)\" /opt/closespan",
      "rm -rf /opt/closespan/node_modules",
      "cp -a node_modules /opt/closespan/node_modules",
    ].join(" && ")]);
    const restoreScript = `#!/bin/sh\nset -eu\ntarget=\${1:?repository target required}\nmkdir -p "$target"\nrm -rf "$target/node_modules"\ncp -a /opt/closespan/node_modules "$target/node_modules"\n`;
    const stagedRestoreScript = "/home/tenki/.closespan-restore-cache.sh";
    const stagedEnvironment = "/home/tenki/.closespan-environment.json";
    await session.writeFile(stagedRestoreScript, restoreScript);
    await session.writeFile(stagedEnvironment, JSON.stringify({
      schemaVersion: 1,
      artifactId,
      orgHash: hash(orgId),
      repositoryHash: hash(`${repository}:${workspaceRoot}`),
      dependencyFingerprint: context.dependencyFingerprint,
      resolvedLockfileHash: resolvedDependencyLock.hash,
      resolvedLockfileSource: resolvedDependencyLock.source,
      sourceSha: context.sourceSha,
      packageManager: context.packageManager,
    }));
    await requireCommand(session, "install", [
      "-m",
      "0555",
      stagedRestoreScript,
      "/opt/closespan/restore-cache.sh",
    ]);
    await requireCommand(session, "install", [
      "-m",
      "0444",
      stagedEnvironment,
      "/opt/closespan/environment.json",
    ]);
    await session.remove(stagedRestoreScript);
    await session.remove(stagedEnvironment);
    await requireCommand(session, "rm", ["-rf", repositoryPath]);
    await requireCommand(session, "bash", ["-lc", `rm -f ~/.npmrc ~/.yarnrc ~/.yarnrc.yml; rm -rf ~/.npm/_logs ~/.cache/node-gyp ${assemblyCache}`]);
    await session.detachVolume(cache.volumeId, { force: false, waitTimeoutMs: 60_000 });
    await tenki.waitVolumeReady(cache.volumeId, 3 * 60_000);
    const expiresAt = new Date(Date.now() + artifactLifetimeMs);
    const pendingSnapshot = await tenki.createSnapshotAsync(session.id, {
      name: `${catalogKey}-v${version}`,
      expiresAt,
    });
    await pool.query(
      `UPDATE tenki_environment_artifacts
          SET tenki_workspace_id=$2,builder_session_id=$3,snapshot_id=$4
        WHERE id=$1 AND status='building'`,
      [artifactId, base.tenki_workspace_id, session.id, pendingSnapshot.id],
    );
    const snapshot = await tenki.waitSnapshotReady(
      pendingSnapshot.id,
      10 * 60_000,
    );
    await tenki.updateSnapshot(snapshot.id, {
      tags: [
        "closespan",
        "private-environment",
        artifactOwnershipTag(artifactId),
        `org-${hash(orgId).slice(0, 12)}`,
      ],
    });
    const published = await publishDurableSnapshot({
      fromSnapshotId: snapshot.id,
      workspaceId: base.tenki_workspace_id,
      name: `${catalogKey}-v${version}-${artifactId.slice(0, 8)}`,
      visibility: "private",
      labels: ["closespan", "private-environment", artifactOwnershipTag(artifactId)],
      title: `CloseSpan private environment for ${repository}`,
      description: "Secretless, dependency-cached environment pinned to an exact repository fingerprint.",
    });
    if (published.image) {
      await pool.query(
        `UPDATE tenki_environment_artifacts
            SET tenki_workspace_id=$2,registry_image_id=$3
          WHERE id=$1 AND status='building'`,
        [
          artifactId,
          base.tenki_workspace_id,
          published.image.id,
        ],
      );
    }
    const lookupRef = snapshotPublicationLookupRef(published, snapshot.id);
    const [freshSnapshot, detail, resolved] = await Promise.all([
      tenki.getSnapshot(snapshot.id),
      tenki.getRegistryImage(lookupRef, {
        workspaceId: base.tenki_workspace_id,
      }),
      tenki.resolveRegistryRef(lookupRef, {
        workspaceId: base.tenki_workspace_id,
      }),
    ]);
    const trustedPublication = assertTrustedSnapshotPublication({
      receipt: published,
      lookupRef,
      snapshot: freshSnapshot,
      detail,
      resolved,
      expectedSnapshotId: snapshot.id,
      expectedWorkspaceId: base.tenki_workspace_id,
      expectedBuilderSessionId: session.id,
      ownershipTag: artifactOwnershipTag(artifactId),
    });
    await pool.query(
      `UPDATE tenki_environment_artifacts
          SET tenki_workspace_id=$2,registry_image_id=$3,
              registry_digest_ref=$4
        WHERE id=$1 AND status='building'`,
      [
        artifactId,
        base.tenki_workspace_id,
        trustedPublication.image.id,
        trustedPublication.registryRef,
      ],
    );
    return {
      builderSessionId: session.id,
      snapshot: trustedPublication.snapshot,
      image: trustedPublication.image,
      digestRef: trustedPublication.registryRef,
      expiresAt,
    };
  } finally {
    if (session) await session.closeIfOpen().catch(() => undefined);
  }
}

async function validatePrivateImage(context, built, resolvedDependencyLock, artifactId) {
  let session;
  try {
    session = await createReadySession({
      name: `closespan-private-validate-${artifactId.slice(0, 8)}`,
      workspaceId: built.image.workspaceId,
      image: built.digestRef,
      allowInbound: false,
      allowOutbound: false,
      cpuCores: 2,
      memoryMb: 4_096,
      maxDurationMs: 8 * 60_000,
      idleTimeoutMinutes: 2,
      tags: ["closespan", "private-environment", "validation"],
      metadata: { purpose: "closespan-private-environment-validation", artifactId },
    });
    if (
      session.inboundEnabled
      || session.outboundEnabled
      || session.workspaceId !== built.image.workspaceId
      || session.sourceRegistryRef !== built.digestRef
      || session.sourceRegistryImageId !== built.image.id
      || session.sourceSnapshotId !== built.snapshot.id
    ) throw new Error("Private environment validation provenance did not match");
    await requireCommand(session, "/opt/closespan/restore-cache.sh", ["/home/tenki/validation"]);
    await requireCommand(session, "bash", ["-lc", [
      "test -d /home/tenki/validation/node_modules",
      `grep -F '${context.dependencyFingerprint}' /opt/closespan/environment.json`,
      `grep -F '${resolvedDependencyLock.hash}' /opt/closespan/environment.json`,
      "node --version",
    ].join(" && ")]);
    return session.id;
  } finally {
    if (session) await session.closeIfOpen().catch(() => undefined);
  }
}

async function promote(artifactId, catalogKey, context, base) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      `tenki-private:${orgId}:${repository}:${workspaceRoot}:${catalogKey}`,
    ]);
    const freshness = await client.query(
      `SELECT profile.detection_evidence->>'dependencyFingerprint' AS fingerprint
         FROM execution_profile_assignments assignment
         JOIN execution_profile_versions profile
           ON profile.org_id=assignment.org_id
          AND profile.id=COALESCE(assignment.detected_profile_id,assignment.active_profile_id)
        WHERE assignment.org_id=$1 AND assignment.repository=$2
          AND assignment.workspace_root=$3`,
      [orgId, repository, workspaceRoot],
    );
    if (freshness.rows[0]?.fingerprint !== context.dependencyFingerprint) {
      throw new Error("Repository detection changed while the private environment was building");
    }
    const activeBase = await client.query(
      `SELECT id FROM tenki_environment_artifacts
        WHERE id=$1 AND scope_type='managed_toolchain' AND status='active'
          AND approved AND registry_digest_ref=$2
        FOR SHARE`,
      [base.id, base.registry_digest_ref],
    );
    if (activeBase.rowCount !== 1) {
      throw new Error("The trusted base environment changed while the private environment was building");
    }
    const candidate = await client.query(
      `SELECT id FROM tenki_environment_artifacts
        WHERE id=$1 AND scope_type='repository_private'
          AND org_id=$2 AND repository=$3 AND workspace_root=$4
          AND catalog_key=$5 AND status='ready' AND approved
          AND dependency_fingerprint=$6
          AND template_spec->>'baseArtifactId'=$7
          AND template_spec->>'baseDigestRef'=$8
          AND template_spec->>'builderRelease'=$9
        FOR UPDATE`,
      [
        artifactId,
        orgId,
        repository,
        workspaceRoot,
        catalogKey,
        context.dependencyFingerprint,
        base.id,
        base.registry_digest_ref,
        builderRelease,
      ],
    );
    if (candidate.rowCount !== 1) {
      throw new Error("The validated private-environment candidate is no longer promotable");
    }
    const prior = await client.query(
      `UPDATE tenki_environment_artifacts
          SET status='deprecated',deprecated_at=now()
        WHERE scope_type='repository_private' AND org_id=$1
          AND repository=$2 AND workspace_root=$3 AND catalog_key=$4
          AND status='active' AND id<>$5
      RETURNING id`,
      [orgId, repository, workspaceRoot, catalogKey, artifactId],
    );
    const activated = await client.query(
      `UPDATE tenki_environment_artifacts
          SET status='active',approved=true,activated_at=now(),supersedes_id=$2
        WHERE id=$1 AND status='ready'`,
      [artifactId, prior.rows[0]?.id ?? null],
    );
    if (activated.rowCount !== 1) {
      throw new Error("Private-environment promotion lost its candidate lock");
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function remotePrivateArtifactCurrent(artifact) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const [snapshot, registry] = await Promise.all([
        tenki.getSnapshot(artifact.snapshot_id),
        tenki.getRegistryImage(artifact.registry_digest_ref, {
          workspaceId: artifact.tenki_workspace_id,
        }),
      ]);
      return snapshot.id === artifact.snapshot_id
        && snapshot.workspaceId === artifact.tenki_workspace_id
        && snapshot.state === "READY"
        && registry.image?.id === artifact.registry_image_id
        && registry.image.workspaceId === artifact.tenki_workspace_id
        && registry.image.visibility === "private"
        && registry.image.kind === "snapshot"
        && registry.resolvedSnapshotId === artifact.snapshot_id
        && !registry.tombstoned;
    } catch (error) {
      if (
        error instanceof SnapshotNotFoundError
        || error instanceof RegistryImageNotFoundError
      ) return false;
      if (attempt === 0) {
        await new Promise((resolve) => setTimeout(resolve, 1_000));
      } else {
        throw error;
      }
    }
  }
  return false;
}

let cache;
let artifactId;
let cachePrefetched = false;
try {
  const context = await profileContext();
  const base = await activeBase(context);
  const catalogKey = `private-${hash(`${orgId}:${repository}:${workspaceRoot}`).slice(0, 32)}`;
  const existing = await pool.query(
    `SELECT id,version,tenki_workspace_id,snapshot_id,registry_image_id,
            registry_digest_ref,expires_at
       FROM tenki_environment_artifacts
      WHERE scope_type='repository_private' AND org_id=$1
        AND repository=$2 AND workspace_root=$3
        AND dependency_fingerprint=$4 AND status='active' AND approved
        AND expires_at > now() + interval '14 days'
        AND template_spec->>'baseArtifactId'=$5
        AND template_spec->>'baseDigestRef'=$6
        AND template_spec->>'builderRelease'=$7
      LIMIT 1`,
    [
      orgId,
      repository,
      workspaceRoot,
      context.dependencyFingerprint,
      base.id,
      base.registry_digest_ref,
      builderRelease,
    ],
  );
  if (
    existing.rows[0]
    && !force
    && await remotePrivateArtifactCurrent(existing.rows[0])
  ) {
    await pool.query(
      `UPDATE tenki_environment_artifacts
          SET last_verified_at=now(),updated_at=now()
        WHERE id=$1 AND status='active'`,
      [existing.rows[0].id],
    );
    console.log(JSON.stringify({
      event: "private-environment-current",
      artifactId: existing.rows[0].id,
      version: existing.rows[0].version,
      digestRef: existing.rows[0].registry_digest_ref,
    }));
  } else {
    artifactId = randomUUID();
    const version = await nextArtifactVersion(catalogKey);
    const plan = {
      schemaVersion: 1,
      kind: "repository-private-node-dependencies",
      builderRelease,
      baseArtifactId: base.id,
      baseDigestRef: base.registry_digest_ref,
      orgHash: hash(orgId),
      repositoryHash: hash(`${repository}:${workspaceRoot}`),
      sourceSha: context.sourceSha,
      dependencyFingerprint: context.dependencyFingerprint,
      packageManager: context.packageManager,
      installCommand: context.installCommand,
      lockfileSource: context.generateNpmLockfile ? "generated" : "repository",
    };
    await pool.query(
      `INSERT INTO tenki_environment_artifacts(
         id,scope_type,org_id,repository,workspace_root,catalog_key,
         runtime_family,runtime_version,package_manager,capabilities,
         dependency_fingerprint,source_sha,version,template_spec,status,
         created_by,expires_at
       ) VALUES($1,'repository_private',$2,$3,$4,$5,'node',$6,$7,$8,$9,$10,$11,$12,
         'building','system:tenki-private-builder',$13)`,
      [
        artifactId,
        orgId,
        repository,
        workspaceRoot,
        catalogKey,
        context.config.runtimeVersion ?? null,
        context.packageManager,
        JSON.stringify([
          "dependency-cache",
          ...(context.config.runtimeTools?.browser ? ["browser"] : []),
        ]),
        context.dependencyFingerprint,
        context.sourceSha,
        version,
        JSON.stringify(plan),
        new Date(Date.now() + artifactLifetimeMs),
      ],
    );
    const token = await githubInstallationToken(context);
    const dependencyFiles = await githubDependencyFiles(context, token);
    let resolvedDependencyLock = resolvedLockfile(
      dependencyFiles,
      context.packageManager,
    );
    cache = await acquireCache(context, base, artifactId);
    const generatedDependencyLock = await prefetch(
      context,
      base,
      cache,
      dependencyFiles,
      artifactId,
    );
    resolvedDependencyLock = generatedDependencyLock ?? resolvedDependencyLock;
    if (!resolvedDependencyLock) {
      throw new Error("The private environment builder could not resolve a dependency lockfile");
    }
    plan.resolvedLockfileHash = resolvedDependencyLock.hash;
    plan.resolvedLockfilePath = resolvedDependencyLock.path;
    plan.lockfileSource = resolvedDependencyLock.source;
    await pool.query(
      `UPDATE tenki_environment_artifacts
          SET template_spec=$2,updated_at=now()
        WHERE id=$1 AND status='building'`,
      [artifactId, JSON.stringify(plan)],
    );
    cachePrefetched = true;
    await heartbeatCache(cache);
    const archive = await githubArchive(context, token);
    const built = await assemble(
      context,
      base,
      cache,
      archive,
      resolvedDependencyLock,
      artifactId,
      catalogKey,
      version,
    );
    await heartbeatCache(cache);
    const validationSessionId = await validatePrivateImage(
      context,
      built,
      resolvedDependencyLock,
      artifactId,
    );
    await heartbeatCache(cache);
    const workspaceId = built.image.workspaceId || base.tenki_workspace_id;
    const planHash = hash(JSON.stringify(plan));
    await pool.query(
      `UPDATE tenki_environment_artifacts
          SET tenki_workspace_id=$2,builder_session_id=$3,
              template_spec_hash=$4,snapshot_id=$5,registry_image_id=$6,
              registry_digest_ref=$7,status='ready',approved=true,
              built_at=now(),validation_session_id=$8,
              validation_evidence=$9,last_verified_at=now()
        WHERE id=$1 AND status='building'`,
      [
        artifactId,
        workspaceId,
        built.builderSessionId,
        planHash,
        built.snapshot.id,
        built.image.id,
        built.digestRef,
        validationSessionId,
        JSON.stringify({
          registryDigestRef: built.digestRef,
          registryImageId: built.image.id,
          snapshotId: built.snapshot.id,
          dependencyFingerprint: context.dependencyFingerprint,
          resolvedLockfileHash: resolvedDependencyLock.hash,
          resolvedLockfileSource: resolvedDependencyLock.source,
          sourceSha: context.sourceSha,
          network: { inbound: false, outbound: false },
        }),
      ],
    );
    await pool.query(
      `INSERT INTO tenki_environment_artifact_events(
         id,artifact_id,event_type,detail,actor_id
       ) VALUES($1,$2,'private.validated',$3,'system:tenki-private-builder')`,
      [randomUUID(), artifactId, JSON.stringify({
        validationSessionId,
        cacheId: cache.id,
        cacheKey: cache.cacheKey,
        resolvedLockfileHash: resolvedDependencyLock.hash,
        resolvedLockfileSource: resolvedDependencyLock.source,
        snapshotId: built.snapshot.id,
        digestRef: built.digestRef,
      })],
    );
    await promote(artifactId, catalogKey, context, base);
    await releaseCache(cache);
    cache = undefined;
    console.log(JSON.stringify({
      event: "private-environment-promoted",
      artifactId,
      version,
      snapshotId: built.snapshot.id,
      digestRef: built.digestRef,
      dependencyFingerprint: context.dependencyFingerprint,
    }));
  }
} catch (error) {
  if (cache) {
    await releaseCache(
      cache,
      cachePrefetched
        ? null
        : error instanceof Error
          ? error.message
          : "Private environment cache prefetch failed",
    ).catch(() => undefined);
  }
  if (artifactId) {
    await pool.query(
      `UPDATE tenki_environment_artifacts
          SET status='failed',approved=false,failure_reason=$2
        WHERE id=$1 AND status IN ('draft','building')`,
      [artifactId, error instanceof Error ? error.message.slice(0, 4_000) : "Private environment build failed"],
    ).catch(() => undefined);
  }
  throw error;
} finally {
  tenki.close();
  await pool.end();
}

// @tenkicloud/sandbox 0.5.4 leaves RPC keepalive handles open after close().
process.exit(0);
