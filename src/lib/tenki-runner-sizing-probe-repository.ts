import { randomUUID } from "node:crypto";
import { databasePool } from "./db";
import type { ExecutionProfileVersion } from "./execution-profile";
import {
  recommendTenkiRunnerSize,
  tenkiRunnerTelemetrySchema,
  type TenkiRunnerTelemetry,
  type TenkiWorkloadClass,
} from "./tenki-runner-sizing";
import { workspacePersistenceMode } from "./workspace-persistence";

export type TenkiRunnerSizingProbeStatus = "Queued" | "Dispatched" | "Running" | "Completed" | "Failed";

export interface TenkiRunnerSizingProbe {
  id: string;
  orgId: string;
  repository: string;
  workspaceRoot: string;
  profileId: string;
  profileHash: string;
  sourceSha: string;
  workflowPath: string;
  workflowSha256: string;
  runnerLabel: string;
  workloadClass: TenkiWorkloadClass;
  workloadReasons: string[];
  probeCommands: string[];
  workingDirectory: string;
  status: TenkiRunnerSizingProbeStatus;
  telemetry: TenkiRunnerTelemetry | null;
  recommendedRunnerLabel: string | null;
  recommendationReasons: string[];
  githubWorkflowRunId: number | null;
  failureCode: string | null;
  failureMessage: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  updatedAt: string;
}

type ProbeRecord = TenkiRunnerSizingProbe;

const state = globalThis as typeof globalThis & {
  closespanTenkiRunnerSizingProbes?: Map<string, ProbeRecord>;
};

function memoryProbes(): Map<string, ProbeRecord> {
  state.closespanTenkiRunnerSizingProbes ??= new Map();
  return state.closespanTenkiRunnerSizingProbes;
}

export function resetMemoryTenkiRunnerSizingProbes(): void {
  memoryProbes().clear();
}

function now(): string {
  return new Date().toISOString();
}

function retryableProbe(probe: Pick<ProbeRecord, "status" | "telemetry">): boolean {
  return probe.status === "Failed"
    || probe.status === "Completed" && probe.telemetry?.exitCode !== 0;
}

type ProbeRow = {
  id: string;
  org_id: string;
  repository: string;
  workspace_root: string;
  profile_id: string;
  profile_hash: string;
  source_sha: string;
  workflow_path: string;
  workflow_sha256: string;
  runner_label: string;
  workload_class: TenkiWorkloadClass;
  workload_reasons: unknown;
  probe_commands: unknown;
  working_directory: string;
  status: TenkiRunnerSizingProbeStatus;
  telemetry: unknown;
  recommended_runner_label: string | null;
  recommendation_reasons: unknown;
  github_workflow_run_id: string | number | null;
  failure_code: string | null;
  failure_message: string | null;
  created_at: Date;
  started_at: Date | null;
  completed_at: Date | null;
  updated_at: Date;
};

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function fromRow(row: ProbeRow): TenkiRunnerSizingProbe {
  return {
    id: row.id,
    orgId: row.org_id,
    repository: row.repository,
    workspaceRoot: row.workspace_root,
    profileId: row.profile_id,
    profileHash: row.profile_hash,
    sourceSha: row.source_sha,
    workflowPath: row.workflow_path,
    workflowSha256: row.workflow_sha256,
    runnerLabel: row.runner_label,
    workloadClass: row.workload_class,
    workloadReasons: strings(row.workload_reasons),
    probeCommands: strings(row.probe_commands),
    workingDirectory: row.working_directory,
    status: row.status,
    telemetry: row.telemetry ? tenkiRunnerTelemetrySchema.parse(row.telemetry) : null,
    recommendedRunnerLabel: row.recommended_runner_label,
    recommendationReasons: strings(row.recommendation_reasons),
    githubWorkflowRunId: row.github_workflow_run_id === null ? null : Number(row.github_workflow_run_id),
    failureCode: row.failure_code,
    failureMessage: row.failure_message,
    createdAt: row.created_at.toISOString(),
    startedAt: row.started_at?.toISOString() ?? null,
    completedAt: row.completed_at?.toISOString() ?? null,
    updatedAt: row.updated_at.toISOString(),
  };
}

const SELECT_FIELDS = `id,org_id,repository,workspace_root,profile_id,profile_hash,
  source_sha,workflow_path,workflow_sha256,runner_label,workload_class,
  workload_reasons,probe_commands,working_directory,status,telemetry,
  recommended_runner_label,recommendation_reasons,github_workflow_run_id,
  failure_code,failure_message,created_at,started_at,completed_at,updated_at`;

export async function queueTenkiRunnerSizingProbe(input: {
  orgId: string;
  profile: ExecutionProfileVersion;
  sourceSha: string;
  workflowPath: string;
  workflowSha256: string;
  runnerLabel: string;
  workloadClass: TenkiWorkloadClass;
  workloadReasons: string[];
  probeCommands: string[];
  workingDirectory: string;
}): Promise<TenkiRunnerSizingProbe> {
  const timestamp = now();
  const record: ProbeRecord = {
    id: randomUUID(),
    orgId: input.orgId,
    repository: input.profile.repository,
    workspaceRoot: input.profile.workspaceRoot,
    profileId: input.profile.id,
    profileHash: input.profile.contentHash,
    sourceSha: input.sourceSha,
    workflowPath: input.workflowPath,
    workflowSha256: input.workflowSha256,
    runnerLabel: input.runnerLabel,
    workloadClass: input.workloadClass,
    workloadReasons: [...input.workloadReasons],
    probeCommands: [...input.probeCommands],
    workingDirectory: input.workingDirectory,
    status: "Queued",
    telemetry: null,
    recommendedRunnerLabel: null,
    recommendationReasons: [],
    githubWorkflowRunId: null,
    failureCode: null,
    failureMessage: null,
    createdAt: timestamp,
    startedAt: null,
    completedAt: null,
    updatedAt: timestamp,
  };
  if (workspacePersistenceMode(input.orgId) === "memory") {
    const existing = [...memoryProbes().values()].find(
      (candidate) => candidate.orgId === input.orgId && candidate.profileId === input.profile.id,
    );
    if (existing) {
      if (!retryableProbe(existing)) return existing;
      const retried: ProbeRecord = {
        ...existing,
        status: "Queued",
        telemetry: null,
        recommendedRunnerLabel: null,
        recommendationReasons: [],
        githubWorkflowRunId: null,
        failureCode: null,
        failureMessage: null,
        startedAt: null,
        completedAt: null,
        updatedAt: timestamp,
      };
      memoryProbes().set(existing.id, retried);
      return retried;
    }
    memoryProbes().set(record.id, record);
    return record;
  }
  const result = await databasePool().query<ProbeRow>(
    `INSERT INTO tenki_runner_sizing_probes(
       id,org_id,repository,workspace_root,profile_id,profile_hash,source_sha,
       workflow_path,workflow_sha256,runner_label,workload_class,workload_reasons,
       probe_commands,working_directory,status
     ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'Queued')
     ON CONFLICT (org_id,profile_id) DO UPDATE SET
       status=CASE WHEN tenki_runner_sizing_probes.status='Failed' OR (tenki_runner_sizing_probes.status='Completed' AND COALESCE((tenki_runner_sizing_probes.telemetry->>'exitCode')::int,-1)<>0) THEN 'Queued' ELSE tenki_runner_sizing_probes.status END,
       telemetry=CASE WHEN tenki_runner_sizing_probes.status='Failed' OR (tenki_runner_sizing_probes.status='Completed' AND COALESCE((tenki_runner_sizing_probes.telemetry->>'exitCode')::int,-1)<>0) THEN NULL ELSE tenki_runner_sizing_probes.telemetry END,
       recommended_runner_label=CASE WHEN tenki_runner_sizing_probes.status='Failed' OR (tenki_runner_sizing_probes.status='Completed' AND COALESCE((tenki_runner_sizing_probes.telemetry->>'exitCode')::int,-1)<>0) THEN NULL ELSE tenki_runner_sizing_probes.recommended_runner_label END,
       recommendation_reasons=CASE WHEN tenki_runner_sizing_probes.status='Failed' OR (tenki_runner_sizing_probes.status='Completed' AND COALESCE((tenki_runner_sizing_probes.telemetry->>'exitCode')::int,-1)<>0) THEN '[]'::jsonb ELSE tenki_runner_sizing_probes.recommendation_reasons END,
       github_workflow_run_id=CASE WHEN tenki_runner_sizing_probes.status='Failed' OR (tenki_runner_sizing_probes.status='Completed' AND COALESCE((tenki_runner_sizing_probes.telemetry->>'exitCode')::int,-1)<>0) THEN NULL ELSE tenki_runner_sizing_probes.github_workflow_run_id END,
       failure_code=CASE WHEN tenki_runner_sizing_probes.status='Failed' OR (tenki_runner_sizing_probes.status='Completed' AND COALESCE((tenki_runner_sizing_probes.telemetry->>'exitCode')::int,-1)<>0) THEN NULL ELSE tenki_runner_sizing_probes.failure_code END,
       failure_message=CASE WHEN tenki_runner_sizing_probes.status='Failed' OR (tenki_runner_sizing_probes.status='Completed' AND COALESCE((tenki_runner_sizing_probes.telemetry->>'exitCode')::int,-1)<>0) THEN NULL ELSE tenki_runner_sizing_probes.failure_message END,
       started_at=CASE WHEN tenki_runner_sizing_probes.status='Failed' OR (tenki_runner_sizing_probes.status='Completed' AND COALESCE((tenki_runner_sizing_probes.telemetry->>'exitCode')::int,-1)<>0) THEN NULL ELSE tenki_runner_sizing_probes.started_at END,
       completed_at=CASE WHEN tenki_runner_sizing_probes.status='Failed' OR (tenki_runner_sizing_probes.status='Completed' AND COALESCE((tenki_runner_sizing_probes.telemetry->>'exitCode')::int,-1)<>0) THEN NULL ELSE tenki_runner_sizing_probes.completed_at END,
       updated_at=CASE WHEN tenki_runner_sizing_probes.status='Failed' OR (tenki_runner_sizing_probes.status='Completed' AND COALESCE((tenki_runner_sizing_probes.telemetry->>'exitCode')::int,-1)<>0) THEN now() ELSE tenki_runner_sizing_probes.updated_at END
     RETURNING ${SELECT_FIELDS}`,
    [
      record.id, input.orgId, record.repository, record.workspaceRoot,
      record.profileId, record.profileHash, record.sourceSha, record.workflowPath,
      record.workflowSha256, record.runnerLabel, record.workloadClass,
      JSON.stringify(record.workloadReasons), JSON.stringify(record.probeCommands),
      record.workingDirectory,
    ],
  );
  if (!result.rows[0]) throw new Error("Tenki runner sizing probe was not queued");
  return fromRow(result.rows[0]);
}

export async function getTenkiRunnerSizingProbe(
  orgId: string,
  probeId: string,
): Promise<TenkiRunnerSizingProbe | null> {
  if (workspacePersistenceMode(orgId) === "memory") {
    const record = memoryProbes().get(probeId);
    return record?.orgId === orgId ? record : null;
  }
  const result = await databasePool().query<ProbeRow>(
    `SELECT ${SELECT_FIELDS} FROM tenki_runner_sizing_probes WHERE org_id=$1 AND id=$2`,
    [orgId, probeId],
  );
  return result.rows[0] ? fromRow(result.rows[0]) : null;
}

export async function getProfileTenkiRunnerSizingProbe(
  orgId: string,
  profileId: string,
): Promise<TenkiRunnerSizingProbe | null> {
  if (workspacePersistenceMode(orgId) === "memory") {
    return [...memoryProbes().values()].find(
      (record) => record.orgId === orgId && record.profileId === profileId,
    ) ?? null;
  }
  const result = await databasePool().query<ProbeRow>(
    `SELECT ${SELECT_FIELDS} FROM tenki_runner_sizing_probes WHERE org_id=$1 AND profile_id=$2`,
    [orgId, profileId],
  );
  return result.rows[0] ? fromRow(result.rows[0]) : null;
}

export async function listTenkiRunnerSizingProbes(
  orgId: string,
): Promise<TenkiRunnerSizingProbe[]> {
  if (workspacePersistenceMode(orgId) === "memory") {
    return [...memoryProbes().values()]
      .filter((record) => record.orgId === orgId)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }
  const result = await databasePool().query<ProbeRow>(
    `SELECT ${SELECT_FIELDS} FROM tenki_runner_sizing_probes WHERE org_id=$1 ORDER BY updated_at DESC`,
    [orgId],
  );
  return result.rows.map(fromRow);
}

export async function markTenkiRunnerSizingProbeRunning(input: {
  orgId: string;
  probeId: string;
  githubWorkflowRunId?: number;
}): Promise<TenkiRunnerSizingProbe> {
  if (workspacePersistenceMode(input.orgId) === "memory") {
    const record = await getTenkiRunnerSizingProbe(input.orgId, input.probeId);
    if (!record) throw new Error("Tenki runner sizing probe was not found");
    const updated = { ...record, status: "Running" as const, startedAt: record.startedAt ?? now(), updatedAt: now(), githubWorkflowRunId: input.githubWorkflowRunId ?? record.githubWorkflowRunId };
    memoryProbes().set(record.id, updated);
    return updated;
  }
  const result = await databasePool().query<ProbeRow>(
    `UPDATE tenki_runner_sizing_probes SET status='Running',started_at=COALESCE(started_at,now()),
       github_workflow_run_id=COALESCE($3,github_workflow_run_id),updated_at=now()
     WHERE org_id=$1 AND id=$2 AND status IN ('Queued','Dispatched','Running') RETURNING ${SELECT_FIELDS}`,
    [input.orgId, input.probeId, input.githubWorkflowRunId ?? null],
  );
  if (!result.rows[0]) throw new Error("Tenki runner sizing probe cannot be started");
  return fromRow(result.rows[0]);
}

export async function markTenkiRunnerSizingProbeDispatched(input: {
  orgId: string;
  probeId: string;
}): Promise<TenkiRunnerSizingProbe> {
  const existing = await getTenkiRunnerSizingProbe(input.orgId, input.probeId);
  if (!existing) throw new Error("Tenki runner sizing probe was not found");
  if (existing.status !== "Queued") return existing;
  if (workspacePersistenceMode(input.orgId) === "memory") {
    const updated: ProbeRecord = { ...existing, status: "Dispatched", updatedAt: now() };
    memoryProbes().set(existing.id, updated);
    return updated;
  }
  const result = await databasePool().query<ProbeRow>(
    `UPDATE tenki_runner_sizing_probes SET status='Dispatched',updated_at=now()
     WHERE org_id=$1 AND id=$2 AND status='Queued' RETURNING ${SELECT_FIELDS}`,
    [input.orgId, input.probeId],
  );
  return result.rows[0] ? fromRow(result.rows[0]) : (await getTenkiRunnerSizingProbe(input.orgId, input.probeId))!;
}

export async function completeTenkiRunnerSizingProbe(input: {
  orgId: string;
  probeId: string;
  telemetry: TenkiRunnerTelemetry;
  githubWorkflowRunId: number;
}): Promise<TenkiRunnerSizingProbe> {
  const telemetry = tenkiRunnerTelemetrySchema.parse(input.telemetry);
  const existing = await getTenkiRunnerSizingProbe(input.orgId, input.probeId);
  if (!existing) throw new Error("Tenki runner sizing probe was not found");
  const recommendation = recommendTenkiRunnerSize({ runnerLabel: existing.runnerLabel, telemetry });
  if (workspacePersistenceMode(input.orgId) === "memory") {
    const updated: ProbeRecord = {
      ...existing,
      status: "Completed",
      telemetry,
      recommendedRunnerLabel: recommendation.recommendedRunnerLabel,
      recommendationReasons: recommendation.reasons,
      githubWorkflowRunId: input.githubWorkflowRunId,
      completedAt: now(),
      updatedAt: now(),
    };
    memoryProbes().set(existing.id, updated);
    return updated;
  }
  const result = await databasePool().query<ProbeRow>(
    `UPDATE tenki_runner_sizing_probes SET status='Completed',telemetry=$3,
       recommended_runner_label=$4,recommendation_reasons=$5,
       github_workflow_run_id=$6,completed_at=now(),updated_at=now()
     WHERE org_id=$1 AND id=$2 AND status IN ('Queued','Dispatched','Running') RETURNING ${SELECT_FIELDS}`,
    [input.orgId, input.probeId, JSON.stringify(telemetry), recommendation.recommendedRunnerLabel, JSON.stringify(recommendation.reasons), input.githubWorkflowRunId],
  );
  if (!result.rows[0]) {
    const idempotent = await getTenkiRunnerSizingProbe(input.orgId, input.probeId);
    if (idempotent?.status === "Completed") return idempotent;
    throw new Error("Tenki runner sizing probe cannot be completed");
  }
  return fromRow(result.rows[0]);
}

export async function failTenkiRunnerSizingProbe(input: {
  orgId: string;
  probeId: string;
  code: string;
  message: string;
}): Promise<TenkiRunnerSizingProbe> {
  const existing = await getTenkiRunnerSizingProbe(input.orgId, input.probeId);
  if (!existing) throw new Error("Tenki runner sizing probe was not found");
  if (workspacePersistenceMode(input.orgId) === "memory") {
    const updated: ProbeRecord = { ...existing, status: "Failed", failureCode: input.code, failureMessage: input.message, completedAt: now(), updatedAt: now() };
    memoryProbes().set(existing.id, updated);
    return updated;
  }
  const result = await databasePool().query<ProbeRow>(
    `UPDATE tenki_runner_sizing_probes SET status='Failed',failure_code=$3,failure_message=$4,
       completed_at=now(),updated_at=now() WHERE org_id=$1 AND id=$2 RETURNING ${SELECT_FIELDS}`,
    [input.orgId, input.probeId, input.code.slice(0, 120), input.message.slice(0, 2_000)],
  );
  if (!result.rows[0]) throw new Error("Tenki runner sizing probe cannot be failed");
  return fromRow(result.rows[0]);
}
