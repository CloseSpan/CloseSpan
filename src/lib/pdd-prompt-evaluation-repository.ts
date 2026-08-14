import { randomUUID } from "node:crypto";
import { databasePool } from "./db";
import {
  pddPromptReviewSchema,
  type PddPromptReview,
} from "./pdd-prompt-review";
import { workspacePersistenceMode } from "./workspace-persistence";

export type PddPromptEvaluationTrigger = "automatic" | "manual";
export type PddPromptEvaluationStatus = "Running" | "Succeeded" | "Failed";

export interface PddPromptEvaluationView {
  id: string;
  triggerSource: PddPromptEvaluationTrigger;
  status: PddPromptEvaluationStatus;
  promptRevisionId: string;
  promptHash: string;
  userStory: string;
  review: PddPromptReview | null;
  failureMessage: string | null;
  acceptancePreparationFailureMessage: string | null;
  appliedPromptRevisionId: string | null;
  applied: boolean;
  automaticAttempted: boolean;
  createdAt: string;
  completedAt: string | null;
}

interface EvaluationRecord extends PddPromptEvaluationView {
  orgId: string;
  problemId: string;
  specificationId: string;
  specificationRevision: number;
  storyHash: string;
}

interface EvaluationRow {
  id: string;
  org_id: string;
  problem_id: string;
  specification_id: string;
  specification_revision: number;
  prompt_revision_id: string;
  prompt_hash: string;
  user_story: string;
  story_hash: string;
  trigger_source: PddPromptEvaluationTrigger;
  status: PddPromptEvaluationStatus;
  review: unknown;
  failure_message: string | null;
  acceptance_preparation_failure_message: string | null;
  applied_prompt_revision_id: string | null;
  created_at: Date;
  completed_at: Date | null;
}

const evaluationState = globalThis as typeof globalThis & {
  closespanPddPromptEvaluations?: Map<string, EvaluationRecord>;
};

function memoryEvaluations(): Map<string, EvaluationRecord> {
  evaluationState.closespanPddPromptEvaluations ??= new Map();
  return evaluationState.closespanPddPromptEvaluations;
}

function storedReview(review: PddPromptReview): PddPromptReview {
  return pddPromptReviewSchema.parse({
    ...review,
    alignmentReceipt: null,
    revisionReceipt: null,
  });
}

function rowReview(value: unknown): PddPromptReview | null {
  if (!value) return null;
  const parsed = pddPromptReviewSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function fromRow(row: EvaluationRow, automaticAttempted: boolean): EvaluationRecord {
  return {
    id: row.id,
    orgId: row.org_id,
    problemId: row.problem_id,
    specificationId: row.specification_id,
    specificationRevision: row.specification_revision,
    promptRevisionId: row.prompt_revision_id,
    promptHash: row.prompt_hash,
    userStory: row.user_story,
    storyHash: row.story_hash,
    triggerSource: row.trigger_source,
    status: row.status,
    review: rowReview(row.review),
    failureMessage: row.failure_message,
    acceptancePreparationFailureMessage:
      row.acceptance_preparation_failure_message,
    appliedPromptRevisionId: row.applied_prompt_revision_id,
    applied: Boolean(row.applied_prompt_revision_id),
    automaticAttempted,
    createdAt: row.created_at.toISOString(),
    completedAt: row.completed_at?.toISOString() ?? null,
  };
}

export async function beginPddPromptEvaluation(input: {
  orgId: string;
  problemId: string;
  specificationId: string;
  specificationRevision: number;
  promptRevisionId: string;
  promptHash: string;
  userStory: string;
  storyHash: string;
  triggerSource: PddPromptEvaluationTrigger;
}): Promise<{ evaluation: PddPromptEvaluationView; shouldRun: boolean }> {
  const id = randomUUID();
  if (workspacePersistenceMode(input.orgId) === "memory") {
    const records = [...memoryEvaluations().values()];
    if (input.triggerSource === "automatic") {
      const existing = records.find((record) =>
        record.orgId === input.orgId
        && record.problemId === input.problemId
        && record.specificationId === input.specificationId
        && record.specificationRevision === input.specificationRevision
        && record.triggerSource === "automatic");
      if (existing) return { evaluation: structuredClone(existing), shouldRun: false };
    }
    const record: EvaluationRecord = {
      id,
      ...input,
      status: "Running",
      review: null,
      failureMessage: null,
      acceptancePreparationFailureMessage: null,
      appliedPromptRevisionId: null,
      applied: false,
      automaticAttempted: input.triggerSource === "automatic",
      createdAt: new Date().toISOString(),
      completedAt: null,
    };
    memoryEvaluations().set(id, record);
    return { evaluation: structuredClone(record), shouldRun: true };
  }

  const inserted = await databasePool().query<EvaluationRow>(
    `INSERT INTO pdd_prompt_evaluations(
       id,org_id,problem_id,specification_id,specification_revision,
       prompt_revision_id,prompt_hash,user_story,story_hash,trigger_source,status
     ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'Running')
     ON CONFLICT (org_id,problem_id,specification_id,specification_revision)
       WHERE trigger_source='automatic'
     DO NOTHING
     RETURNING *`,
    [id, input.orgId, input.problemId, input.specificationId,
      input.specificationRevision, input.promptRevisionId, input.promptHash,
      input.userStory, input.storyHash, input.triggerSource],
  );
  if (inserted.rows[0]) {
    return {
      evaluation: fromRow(inserted.rows[0], input.triggerSource === "automatic"),
      shouldRun: true,
    };
  }
  const existing = await databasePool().query<EvaluationRow>(
    `SELECT * FROM pdd_prompt_evaluations
      WHERE org_id=$1 AND problem_id=$2 AND specification_id=$3
        AND specification_revision=$4 AND trigger_source='automatic'
      ORDER BY created_at DESC,id DESC LIMIT 1`,
    [input.orgId, input.problemId, input.specificationId, input.specificationRevision],
  );
  if (!existing.rows[0]) throw new Error("The automatic Prompt Testing evaluation could not be reconciled");
  return { evaluation: fromRow(existing.rows[0], true), shouldRun: false };
}

export async function completePddPromptEvaluation(
  orgId: string,
  evaluationId: string,
  review: PddPromptReview,
): Promise<void> {
  const safeReview = storedReview(review);
  if (workspacePersistenceMode(orgId) === "memory") {
    const current = memoryEvaluations().get(evaluationId);
    if (!current || current.orgId !== orgId) return;
    memoryEvaluations().set(evaluationId, {
      ...current,
      status: "Succeeded",
      review: safeReview,
      completedAt: new Date().toISOString(),
    });
    return;
  }
  await databasePool().query(
    `UPDATE pdd_prompt_evaluations
        SET status='Succeeded',review=$3,failure_message=NULL,completed_at=now()
      WHERE org_id=$1 AND id=$2 AND status='Running'`,
    [orgId, evaluationId, JSON.stringify(safeReview)],
  );
}

export async function failPddPromptEvaluation(
  orgId: string,
  evaluationId: string,
  message: string,
): Promise<void> {
  if (workspacePersistenceMode(orgId) === "memory") {
    const current = memoryEvaluations().get(evaluationId);
    if (!current || current.orgId !== orgId) return;
    memoryEvaluations().set(evaluationId, {
      ...current,
      status: "Failed",
      failureMessage: message,
      completedAt: new Date().toISOString(),
    });
    return;
  }
  await databasePool().query(
    `UPDATE pdd_prompt_evaluations
        SET status='Failed',failure_message=$3,completed_at=now()
      WHERE org_id=$1 AND id=$2 AND status='Running'`,
    [orgId, evaluationId, message.slice(0, 2_000)],
  );
}

export async function markPddPromptEvaluationApplied(
  orgId: string,
  evaluationId: string,
  appliedPromptRevisionId: string,
): Promise<void> {
  if (workspacePersistenceMode(orgId) === "memory") {
    const current = memoryEvaluations().get(evaluationId);
    if (!current || current.orgId !== orgId) return;
    memoryEvaluations().set(evaluationId, {
      ...current,
      appliedPromptRevisionId,
      applied: true,
    });
    return;
  }
  await databasePool().query(
    `UPDATE pdd_prompt_evaluations
        SET applied_prompt_revision_id=$3
      WHERE org_id=$1 AND id=$2 AND status='Succeeded'`,
    [orgId, evaluationId, appliedPromptRevisionId],
  );
}

export async function recordPddAcceptancePreparationFailure(input: {
  orgId: string;
  problemId: string;
  evaluationId: string;
  promptRevisionId: string;
  message: string;
}): Promise<void> {
  const message = input.message.slice(0, 2_000);
  if (workspacePersistenceMode(input.orgId) === "memory") {
    const current = memoryEvaluations().get(input.evaluationId);
    if (
      !current
      || current.orgId !== input.orgId
      || current.problemId !== input.problemId
      || (
        current.promptRevisionId !== input.promptRevisionId
        && current.appliedPromptRevisionId !== input.promptRevisionId
      )
      || current.status !== "Succeeded"
    ) return;
    memoryEvaluations().set(input.evaluationId, {
      ...current,
      acceptancePreparationFailureMessage: message,
    });
    return;
  }
  await databasePool().query(
    `UPDATE pdd_prompt_evaluations
        SET acceptance_preparation_failure_message=$5
      WHERE org_id=$1 AND problem_id=$2 AND id=$3
        AND (prompt_revision_id=$4 OR applied_prompt_revision_id=$4)
        AND status='Succeeded'`,
    [
      input.orgId,
      input.problemId,
      input.evaluationId,
      input.promptRevisionId,
      message,
    ],
  );
}

export async function clearPddAcceptancePreparationFailure(input: {
  orgId: string;
  problemId: string;
  evaluationId: string;
  promptRevisionId: string;
}): Promise<void> {
  if (workspacePersistenceMode(input.orgId) === "memory") {
    const current = memoryEvaluations().get(input.evaluationId);
    if (
      !current
      || current.orgId !== input.orgId
      || current.problemId !== input.problemId
      || (
        current.promptRevisionId !== input.promptRevisionId
        && current.appliedPromptRevisionId !== input.promptRevisionId
      )
      || current.status !== "Succeeded"
    ) return;
    memoryEvaluations().set(input.evaluationId, {
      ...current,
      acceptancePreparationFailureMessage: null,
    });
    return;
  }
  await databasePool().query(
    `UPDATE pdd_prompt_evaluations
        SET acceptance_preparation_failure_message=NULL
      WHERE org_id=$1 AND problem_id=$2 AND id=$3
        AND (prompt_revision_id=$4 OR applied_prompt_revision_id=$4)
        AND status='Succeeded'`,
    [input.orgId, input.problemId, input.evaluationId, input.promptRevisionId],
  );
}

export async function readPddPromptEvaluation(
  orgId: string,
  problemId: string,
  currentPromptRevisionId?: string | null,
): Promise<PddPromptEvaluationView | null> {
  if (workspacePersistenceMode(orgId) === "memory") {
    const records = [...memoryEvaluations().values()]
      .filter((record) => record.orgId === orgId && record.problemId === problemId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    const latest = records.find((record) =>
      !currentPromptRevisionId
      || record.promptRevisionId === currentPromptRevisionId
      || record.appliedPromptRevisionId === currentPromptRevisionId);
    if (!latest) return null;
    return structuredClone({
      ...latest,
      automaticAttempted: records.some((record) =>
        record.specificationId === latest.specificationId
        && record.specificationRevision === latest.specificationRevision
        && record.triggerSource === "automatic"),
    });
  }
  const result = await databasePool().query<EvaluationRow & { automatic_attempted: boolean }>(
    `SELECT evaluation.*,
            EXISTS(
              SELECT 1 FROM pdd_prompt_evaluations automatic
               WHERE automatic.org_id=evaluation.org_id
                 AND automatic.problem_id=evaluation.problem_id
                 AND automatic.specification_id=evaluation.specification_id
                 AND automatic.specification_revision=evaluation.specification_revision
                 AND automatic.trigger_source='automatic'
            ) AS automatic_attempted
       FROM pdd_prompt_evaluations evaluation
      WHERE evaluation.org_id=$1 AND evaluation.problem_id=$2
        AND ($3::uuid IS NULL
          OR evaluation.prompt_revision_id=$3
          OR evaluation.applied_prompt_revision_id=$3)
      ORDER BY evaluation.created_at DESC,evaluation.id DESC LIMIT 1`,
    [orgId, problemId, currentPromptRevisionId ?? null],
  );
  const row = result.rows[0];
  return row ? fromRow(row, row.automatic_attempted) : null;
}

export async function readPddAcceptanceContract(
  orgId: string,
  problemId: string,
  currentPromptRevisionId: string,
): Promise<string | undefined> {
  if (workspacePersistenceMode(orgId) === "memory") {
    return [...memoryEvaluations().values()]
      .filter((record) =>
        record.orgId === orgId
        && record.problemId === problemId
        && (
          record.promptRevisionId === currentPromptRevisionId
          || record.appliedPromptRevisionId === currentPromptRevisionId
        )
        && record.review?.acceptanceContract)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0]
      ?.review?.acceptanceContract;
  }
  const result = await databasePool().query<{ acceptance_contract: string | null }>(
    `SELECT review->>'acceptanceContract' AS acceptance_contract
       FROM pdd_prompt_evaluations
      WHERE org_id=$1 AND problem_id=$2 AND status='Succeeded'
        AND (prompt_revision_id=$3 OR applied_prompt_revision_id=$3)
        AND review->>'acceptanceContract' IS NOT NULL
      ORDER BY created_at DESC,id DESC LIMIT 1`,
    [orgId, problemId, currentPromptRevisionId],
  );
  return result.rows[0]?.acceptance_contract ?? undefined;
}

export function resetMemoryPddPromptEvaluations(): void {
  memoryEvaluations().clear();
}
