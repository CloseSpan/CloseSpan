import { randomUUID } from "node:crypto";
import { databasePool } from "./db";
import { workspacePersistenceMode } from "./workspace-persistence";

const DEFAULT_ESTIMATE_MS = 45_000;
const MIN_ESTIMATE_MS = 4_000;
const MAX_ESTIMATE_MS = 240_000;
const MAX_MEMORY_SAMPLES = 30;

export interface PddPromptTimingSummary {
  estimatedDurationMs: number;
  averageDurationMs: number | null;
  sampleCount: number;
}

const globalTimingState = globalThis as typeof globalThis & {
  closespanPddPromptTimings?: Map<string, number[]>;
};

function memoryTimings(): Map<string, number[]> {
  globalTimingState.closespanPddPromptTimings ??= new Map();
  return globalTimingState.closespanPddPromptTimings;
}

export function boundedPddEstimate(durationMs: number | null): number {
  if (durationMs === null || !Number.isFinite(durationMs)) {
    return DEFAULT_ESTIMATE_MS;
  }
  return Math.max(MIN_ESTIMATE_MS, Math.min(MAX_ESTIMATE_MS, Math.round(durationMs)));
}

function timingSummary(samples: number[]): PddPromptTimingSummary {
  if (samples.length === 0) {
    return {
      estimatedDurationMs: DEFAULT_ESTIMATE_MS,
      averageDurationMs: null,
      sampleCount: 0,
    };
  }
  const averageDurationMs = Math.round(
    samples.reduce((total, sample) => total + sample, 0) / samples.length,
  );
  return {
    estimatedDurationMs: boundedPddEstimate(averageDurationMs),
    averageDurationMs,
    sampleCount: samples.length,
  };
}

export async function readPddPromptTimingSummary(
  orgId: string,
): Promise<PddPromptTimingSummary> {
  if (workspacePersistenceMode(orgId) === "memory") {
    return timingSummary(memoryTimings().get(orgId) ?? []);
  }

  let result;
  try {
    result = await databasePool().query<{
      sample_count: string;
      average_duration_ms: string | null;
    }>(
      `SELECT COUNT(*)::text AS sample_count,
              ROUND(AVG(duration_ms))::text AS average_duration_ms
         FROM (
           SELECT duration_ms
             FROM pdd_prompt_evaluation_timings
            WHERE org_id=$1
              AND status='Succeeded'
              AND created_at >= now() - interval '30 days'
            ORDER BY created_at DESC
            LIMIT 30
         ) recent`,
      [orgId],
    );
  } catch (error) {
    if ((error as { code?: string }).code === "42P01") {
      return timingSummary([]);
    }
    throw error;
  }
  const row = result.rows[0];
  const sampleCount = Number(row?.sample_count ?? 0);
  const averageDurationMs = row?.average_duration_ms === null
    || row?.average_duration_ms === undefined
    ? null
    : Number(row.average_duration_ms);
  return {
    estimatedDurationMs: boundedPddEstimate(averageDurationMs),
    averageDurationMs,
    sampleCount,
  };
}

export async function recordPddPromptEvaluationTiming(input: {
  orgId: string;
  problemId: string;
  status: "Succeeded" | "Failed";
  durationMs: number;
}): Promise<void> {
  const durationMs = Math.max(1, Math.min(300_000, Math.round(input.durationMs)));
  if (workspacePersistenceMode(input.orgId) === "memory") {
    if (input.status !== "Succeeded") return;
    const samples = memoryTimings().get(input.orgId) ?? [];
    memoryTimings().set(
      input.orgId,
      [durationMs, ...samples].slice(0, MAX_MEMORY_SAMPLES),
    );
    return;
  }
  try {
    await databasePool().query(
      `INSERT INTO pdd_prompt_evaluation_timings(
         id,org_id,problem_id,status,duration_ms
       ) VALUES ($1,$2,$3,$4,$5)`,
      [randomUUID(), input.orgId, input.problemId, input.status, durationMs],
    );
  } catch (error) {
    if ((error as { code?: string }).code !== "42P01") throw error;
  }
}

export function resetMemoryPddPromptTimings(): void {
  memoryTimings().clear();
}
