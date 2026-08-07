import { createHash, randomUUID } from "node:crypto";
import process from "node:process";
import pg from "pg";
import {
  RegistryImageNotFoundError,
  SnapshotNotFoundError,
  TemplateNotFoundError,
  TenkiSandbox,
  TemplateSpec,
} from "@tenkicloud/sandbox";
import {
  assertTrustedTemplateBuild,
  normalizeTenkiSha256,
} from "./tenki-template-build-provenance.mjs";

const apiKey = process.env.TENKI_API_KEY?.trim();
const databaseUrl = process.env.DATABASE_URL?.trim();
const configuredWorkspaceId = process.env.TENKI_WORKSPACE_ID?.trim() || undefined;
if (!apiKey) throw new Error("TENKI_API_KEY is required");
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const force = process.argv.includes("--force");
const noPromote = process.argv.includes("--no-promote");
const onlyArgument = process.argv.find((value) => value.startsWith("--only="));
const only = onlyArgument?.slice("--only=".length) || null;
const playwrightVersion = "1.51.1";
const uvVersion = "0.8.22";
const poetryVersion = "2.2.1";
const pipenvVersion = "2025.0.4";
const artifactLifetimeMs = 90 * 24 * 60 * 60_000;
const buildTimeoutMs = 30 * 60_000;

const browserProbe = `export NODE_PATH="$(npm root --global)"; node -e "const{chromium}=require('playwright');(async()=>{const b=await chromium.launch({headless:true});const c=await b.newContext({serviceWorkers:'block'});if(typeof c.routeWebSocket!=='function')throw new Error('Playwright WebSocket routing is unavailable');await c.close();await b.close()})().catch(e=>{console.error(e instanceof Error?e.message:String(e));process.exit(1)})"`;

function provenanceWrite(document) {
  const encoded = Buffer.from(JSON.stringify(document), "utf8").toString("base64");
  return [
    "mkdir -p /home/tenki/.closespan",
    `printf '%s' '${encoded}' | base64 -d > /home/tenki/.closespan/environment.json`,
    "chmod 0444 /home/tenki/.closespan/environment.json",
  ].join(" && ");
}

function nodeSpec() {
  return new TemplateSpec()
    .run([
      "set -eu",
      `npm install --global playwright@${playwrightVersion}`,
      `node "$(npm root --global)/playwright/cli.js" install --with-deps chromium`,
      browserProbe,
      provenanceWrite({
        schemaVersion: 1,
        catalogKey: "node-browser",
        runtimeFamily: "node",
        playwrightVersion,
      }),
    ].join("\n"));
}

function pythonSpec() {
  return new TemplateSpec()
    .run([
      "set -eu",
      "sudo apt-get update",
      "sudo DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends python3 python3-pip python3-venv",
      "mkdir -p /home/tenki/.closespan",
      "python3 -m venv /home/tenki/.closespan/python",
      "sudo ln -sf /usr/bin/python3 /usr/local/bin/python",
      "python --version",
      `/home/tenki/.closespan/python/bin/python -m pip install --disable-pip-version-check uv==${uvVersion} poetry==${poetryVersion} pipenv==${pipenvVersion}`,
      "sudo ln -sf /home/tenki/.closespan/python/bin/uv /usr/local/bin/uv",
      "sudo ln -sf /home/tenki/.closespan/python/bin/poetry /usr/local/bin/poetry",
      "sudo ln -sf /home/tenki/.closespan/python/bin/pipenv /usr/local/bin/pipenv",
      "python -c \"import json,sys;print(json.dumps({'python':sys.version_info[:3]}))\"",
      "uv --version && poetry --version && pipenv --version",
      "sudo rm -rf /var/lib/apt/lists/*",
      provenanceWrite({
        schemaVersion: 1,
        catalogKey: "python",
        runtimeFamily: "python",
        uvVersion,
        poetryVersion,
        pipenvVersion,
      }),
    ].join("\n"));
}

const definitions = [
  {
    catalogKey: "node-browser",
    runtimeFamily: "node",
    runtimeVersion: null,
    packageManager: null,
    capabilities: ["browser"],
    spec: nodeSpec(),
    validateCommands: [
      ["bash", ["-lc", "node --version && npm --version"]],
      ["bash", ["-lc", browserProbe]],
    ],
    runtimeProbe: ["node", ["-p", "process.versions.node"]],
  },
  {
    catalogKey: "python",
    runtimeFamily: "python",
    runtimeVersion: null,
    packageManager: null,
    capabilities: [],
    spec: pythonSpec(),
    validateCommands: [
      ["bash", ["-lc", "python --version && uv --version && poetry --version && pipenv --version"]],
    ],
    runtimeProbe: ["python", ["-c", "import platform;print(platform.python_version())"]],
  },
].filter((definition) => !only || definition.catalogKey === only);

if (only && definitions.length === 0) {
  throw new Error(`Unknown managed environment catalog key: ${only}`);
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

function specDocument(spec) {
  return spec.toJSON();
}

function authoredSpecHash(spec) {
  return createHash("sha256")
    .update(JSON.stringify(specDocument(spec)))
    .digest("hex");
}

function normalizedSpecHash(value) {
  return normalizeTenkiSha256(value, "Tenki template specification hash");
}

function artifactOwnershipTag(artifactId) {
  return `artifact-${artifactId.replaceAll("-", "").slice(0, 23)}`;
}

function commandOutput(result) {
  return [result.stdout, result.stderr]
    .map((value) => new TextDecoder().decode(value).trim())
    .filter(Boolean)
    .join("\n")
    .slice(-8_000);
}

async function requireCommand(session, command, args, timeoutMs = 180_000) {
  const result = await session.exec(command, { args, timeoutMs });
  if (result.status !== "SUCCEEDED" || result.exitCode !== 0) {
    throw new Error(`${command} failed during managed-environment validation: ${commandOutput(result)}`);
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

async function existingArtifact(definition, hash) {
  const result = await pool.query(
    `SELECT id,version,template_spec,template_spec_hash,status,registry_digest_ref,
            tenki_workspace_id,template_id,registry_image_id,snapshot_id,expires_at
       FROM tenki_environment_artifacts
      WHERE scope_type='managed_toolchain' AND catalog_key=$1
      ORDER BY version DESC`,
    [definition.catalogKey],
  );
  return result.rows.find((row) =>
    row.status === "active"
    && createHash("sha256").update(JSON.stringify(row.template_spec)).digest("hex") === hash
    && (!row.expires_at || Date.parse(row.expires_at) > Date.now() + 14 * 24 * 60 * 60_000));
}

async function remotelyCurrent(row) {
  try {
    const [template, snapshot, registry] = await Promise.all([
      tenki.getTemplate(row.template_id),
      tenki.getSnapshot(row.snapshot_id),
      tenki.getRegistryImage(row.registry_digest_ref, {
        workspaceId: row.tenki_workspace_id,
      }),
    ]);
    return template.id === row.template_id
      && template.workspaceId === row.tenki_workspace_id
      && snapshot.id === row.snapshot_id
      && snapshot.workspaceId === row.tenki_workspace_id
      && snapshot.state === "READY"
      && registry.image?.id === row.registry_image_id
      && registry.image.workspaceId === row.tenki_workspace_id
      && registry.image.visibility === "private"
      && registry.resolvedSnapshotId === row.snapshot_id
      && registry.workspaceActive
      && !registry.tombstoned;
  } catch (error) {
    if (
      error instanceof TemplateNotFoundError
      || error instanceof SnapshotNotFoundError
      || error instanceof RegistryImageNotFoundError
    ) return false;
    throw error;
  }
}

async function nextVersion(definition) {
  const result = await pool.query(
    `SELECT COALESCE(MAX(version),0)::integer + 1 AS version
       FROM tenki_environment_artifacts
      WHERE scope_type='managed_toolchain' AND catalog_key=$1`,
    [definition.catalogKey],
  );
  return result.rows[0]?.version ?? 1;
}

async function recordEvent(artifactId, eventType, detail) {
  await pool.query(
    `INSERT INTO tenki_environment_artifact_events(
       id,artifact_id,event_type,detail,actor_id
     ) VALUES($1,$2,$3,$4,'system:tenki-catalog-reconciler')`,
    [randomUUID(), artifactId, eventType, JSON.stringify(detail)],
  );
}

async function validateImage(
  definition,
  artifactId,
  image,
  snapshotId,
  expectedWorkspaceId,
) {
  let session;
  try {
    session = await createReadySession({
      name: `closespan-validate-${definition.catalogKey}-${artifactId.slice(0, 8)}`,
      image: image.digestRef,
      allowInbound: false,
      allowOutbound: false,
      workspaceId: expectedWorkspaceId,
      cpuCores: 2,
      memoryMb: 4_096,
      maxDurationMs: 10 * 60_000,
      idleTimeoutMinutes: 2,
      tags: ["closespan", "managed-environment", "validation"],
      metadata: {
        purpose: "closespan-managed-environment-validation",
        artifactId,
        catalogKey: definition.catalogKey,
      },
    });
    if (
      session.inboundEnabled
      || session.outboundEnabled
      || session.workspaceId !== expectedWorkspaceId
    ) {
      throw new Error("Managed environment validation session was not network isolated");
    }
    if (
      session.sourceRegistryRef !== image.digestRef
      || session.sourceRegistryImageId !== image.id
      || session.sourceSnapshotId !== snapshotId
    ) {
      throw new Error(JSON.stringify({
        message: "Managed environment provenance did not match",
        expected: { digestRef: image.digestRef, imageId: image.id, snapshotId },
        observed: {
          digestRef: session.sourceRegistryRef ?? null,
          imageId: session.sourceRegistryImageId ?? null,
          snapshotId: session.sourceSnapshotId ?? null,
        },
      }));
    }
    for (const [command, args] of definition.validateCommands) {
      await requireCommand(session, command, args);
    }
    const runtimeResult = await requireCommand(
      session,
      definition.runtimeProbe[0],
      definition.runtimeProbe[1],
    );
    const runtimeVersion = commandOutput(runtimeResult).split(/\r?\n/)[0]?.trim();
    if (!/^\d+\.\d+(?:\.\d+)?/.test(runtimeVersion ?? "")) {
      throw new Error("Managed environment did not report a valid runtime version");
    }
    await requireCommand(session, "bash", [
      "-lc",
      `test -r /home/tenki/.closespan/environment.json && grep -F '${definition.catalogKey}' /home/tenki/.closespan/environment.json`,
    ]);
    return { sessionId: session.id, runtimeVersion };
  } finally {
    if (session) await session.closeIfOpen().catch(() => undefined);
  }
}

async function promote(artifactId, definition) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
      [`tenki-catalog:${definition.catalogKey}`],
    );
    const candidate = await client.query(
      `SELECT id FROM tenki_environment_artifacts
        WHERE id=$1 AND scope_type='managed_toolchain'
          AND catalog_key=$2 AND status='ready' AND approved
        FOR UPDATE`,
      [artifactId, definition.catalogKey],
    );
    if (candidate.rowCount !== 1) {
      throw new Error("The validated managed-environment candidate is no longer promotable");
    }
    const prior = await client.query(
      `UPDATE tenki_environment_artifacts
          SET status='deprecated',deprecated_at=now(),updated_at=now()
        WHERE scope_type='managed_toolchain' AND catalog_key=$1
          AND status='active' AND id<>$2
      RETURNING id,registry_digest_ref`,
      [definition.catalogKey, artifactId],
    );
    const activated = await client.query(
      `UPDATE tenki_environment_artifacts
          SET status='active',approved=true,activated_at=now(),updated_at=now(),
              supersedes_id=$2
        WHERE id=$1 AND status='ready'`,
      [artifactId, prior.rows[0]?.id ?? null],
    );
    if (activated.rowCount !== 1) {
      throw new Error("Managed-environment promotion lost its candidate lock");
    }
    await client.query(
      `INSERT INTO tenki_environment_artifact_events(
         id,artifact_id,event_type,detail,actor_id
       ) VALUES($1,$2,'catalog.promoted',$3,'system:tenki-catalog-reconciler')`,
      [randomUUID(), artifactId, JSON.stringify({
        supersededArtifactIds: prior.rows.map((row) => row.id),
      })],
    );
    await client.query("COMMIT");
    return prior.rows;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function reconcile(definition) {
  const localHash = authoredSpecHash(definition.spec);
  const existing = await existingArtifact(definition, localHash);
  if (existing && !force && await remotelyCurrent(existing)) {
    console.log(JSON.stringify({
      event: "catalog-current",
      catalogKey: definition.catalogKey,
      artifactId: existing.id,
      version: existing.version,
      digestRef: existing.registry_digest_ref,
    }));
    return;
  }

  const artifactId = randomUUID();
  const version = await nextVersion(definition);
  const expiresAt = new Date(Date.now() + artifactLifetimeMs);
  const templateName = `closespan-${definition.catalogKey}-v${version}-${artifactId.slice(0, 8)}`;
  await pool.query(
    `INSERT INTO tenki_environment_artifacts(
       id,scope_type,catalog_key,runtime_family,runtime_version,
       package_manager,capabilities,version,template_spec,status,created_by,expires_at
     ) VALUES($1,'managed_toolchain',$2,$3,$4,$5,$6,$7,$8,'building',
       'system:tenki-catalog-reconciler',$9)`,
    [
      artifactId,
      definition.catalogKey,
      definition.runtimeFamily,
      definition.runtimeVersion,
      definition.packageManager,
      JSON.stringify(definition.capabilities),
      version,
      JSON.stringify(specDocument(definition.spec)),
      expiresAt,
    ],
  );
  await recordEvent(artifactId, "catalog.build_started", { version, localHash });

  try {
    const template = await tenki.createTemplate({
      ...(configuredWorkspaceId ? { workspaceId: configuredWorkspaceId } : {}),
      name: templateName,
      spec: definition.spec,
      tags: [
        "closespan",
        "managed-environment",
        `catalog-${definition.catalogKey}`,
        artifactOwnershipTag(artifactId),
      ],
    });
    await pool.query(
      `UPDATE tenki_environment_artifacts
          SET tenki_workspace_id=$2,template_id=$3
        WHERE id=$1 AND status='building'`,
      [artifactId, template.workspaceId, template.id],
    );
    let build = await tenki.buildTemplate(template, {
      publishRawImage: true,
      waitForCompletion: false,
    });
    await pool.query(
      `UPDATE tenki_environment_artifacts
          SET build_id=$2,template_spec_hash=$3
        WHERE id=$1 AND status='building'`,
      [artifactId, build.id, normalizedSpecHash(build.specHash || localHash)],
    );
    try {
      build = await tenki.waitForTemplateBuild(build, {
        signal: AbortSignal.timeout(buildTimeoutMs),
        onEvent(event) {
        if (event.type !== "log") {
          console.log(JSON.stringify({
            event: "template-build-progress",
            catalogKey: definition.catalogKey,
            phase: event.phase,
            state: event.state,
          }));
        }
        },
      });
    } catch (error) {
      await tenki.cancelTemplateBuild(build).catch(() => undefined);
      throw error;
    }
    if (build.state !== "READY" || !build.image || !build.snapshotId) {
      throw new Error(build.error || "Tenki template did not produce an immutable image");
    }
    const persistedDigestRef = /@sha256:[a-f0-9]{64}$/.test(build.image.digestRef)
      ? build.image.digestRef
      : null;
    await pool.query(
      `UPDATE tenki_environment_artifacts
          SET tenki_workspace_id=$2,template_id=$3,build_id=$4,
              template_spec_hash=$5,snapshot_id=$6,registry_image_id=$7,
              registry_digest_ref=$8
        WHERE id=$1 AND status='building'`,
      [
        artifactId,
        template.workspaceId,
        template.id,
        build.id,
        normalizedSpecHash(build.specHash),
        build.snapshotId,
        build.image.id,
        persistedDigestRef,
      ],
    );
    assertTrustedTemplateBuild({
      template,
      build,
      ownershipTag: artifactOwnershipTag(artifactId),
    });
    await tenki.updateSnapshot(build.snapshotId, {
      name: `closespan-${definition.catalogKey}-v${version}`,
      expiresAt,
      tags: [
        "closespan",
        "managed-environment",
        `catalog-${definition.catalogKey}`,
        artifactOwnershipTag(artifactId),
        "candidate",
      ],
    });
    const validation = await validateImage(
      definition,
      artifactId,
      build.image,
      build.snapshotId,
      template.workspaceId,
    );
    await pool.query(
      `UPDATE tenki_environment_artifacts
          SET tenki_workspace_id=$2,template_id=$3,template_spec_hash=$4,
              build_id=$5,snapshot_id=$6,registry_image_id=$7,
              registry_digest_ref=$8,status='ready',approved=true,
              built_at=now(),validation_session_id=$9,
              validation_evidence=$10,runtime_version=$11,
              last_verified_at=now(),updated_at=now()
        WHERE id=$1 AND status='building'`,
      [
        artifactId,
        template.workspaceId,
        template.id,
        normalizedSpecHash(build.specHash),
        build.id,
        build.snapshotId,
        build.image.id,
        build.image.digestRef,
        validation.sessionId,
        JSON.stringify({
          registryDigestRef: build.image.digestRef,
          registryImageId: build.image.id,
          snapshotId: build.snapshotId,
          network: { inbound: false, outbound: false },
        }),
        validation.runtimeVersion,
      ],
    );
    await recordEvent(artifactId, "catalog.validated", {
      validationSessionId: validation.sessionId,
      digestRef: build.image.digestRef,
      snapshotId: build.snapshotId,
    });
    const superseded = noPromote
      ? []
      : await promote(artifactId, definition);
    console.log(JSON.stringify({
      event: noPromote ? "catalog-ready" : "catalog-promoted",
      catalogKey: definition.catalogKey,
      artifactId,
      version,
      snapshotId: build.snapshotId,
      registryImageId: build.image.id,
      digestRef: build.image.digestRef,
      superseded,
    }));
  } catch (error) {
    await pool.query(
      `UPDATE tenki_environment_artifacts
          SET status='failed',approved=false,failure_reason=$2,updated_at=now()
        WHERE id=$1 AND status IN ('draft','building')`,
      [artifactId, error instanceof Error ? error.message.slice(0, 4_000) : "Unknown build failure"],
    );
    await recordEvent(artifactId, "catalog.build_failed", {
      message: error instanceof Error ? error.message : "Unknown build failure",
    });
    throw error;
  }
}

try {
  for (const definition of definitions) await reconcile(definition);
} finally {
  tenki.close();
  await pool.end();
}

// @tenkicloud/sandbox 0.5.4 does not expose an RPC transport shutdown; its
// keepalive handles otherwise keep this one-shot lifecycle command alive.
process.exit(0);
