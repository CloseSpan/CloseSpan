import { randomUUID } from "node:crypto";
import { databasePool } from "./db";
import { workspacePersistenceMode } from "./workspace-persistence";

export interface PendingTenkiRunnerWorkflowSetup {
  repository: string;
  workflowPath: string;
  pullRequestNumber: number;
  pullRequestUrl: string;
  updatedAt: string;
}

export type TenkiRunnerWorkflowSetupStatus =
  | "Preparing"
  | "Pending"
  | "Installed"
  | "Failed";

export interface TenkiRunnerWorkflowSetupView {
  repository: string;
  workflowPath: string;
  pullRequestNumber: number | null;
  pullRequestUrl: string | null;
  status: TenkiRunnerWorkflowSetupStatus;
  mergedSha: string | null;
  failureMessage: string | null;
  updatedAt: string;
}

interface SetupRecord {
  orgId: string;
  repository: string;
  workflowPath: string;
  pullRequestNumber: number | null;
  pullRequestUrl: string | null;
  status: TenkiRunnerWorkflowSetupStatus;
  mergedSha: string | null;
  failureMessage: string | null;
  updatedAt: string;
}

const setupState = globalThis as typeof globalThis & {
  closespanTenkiRunnerWorkflowSetups?: Map<string, SetupRecord>;
};

function memorySetups(): Map<string, SetupRecord> {
  setupState.closespanTenkiRunnerWorkflowSetups ??= new Map();
  return setupState.closespanTenkiRunnerWorkflowSetups;
}

function key(orgId: string, repository: string): string {
  return `${orgId}:${repository}`;
}

function memoryRecord(
  input: Pick<SetupRecord, "orgId" | "repository" | "workflowPath" | "status">
    & Partial<Pick<SetupRecord, "pullRequestNumber" | "pullRequestUrl" | "mergedSha" | "failureMessage">>,
): SetupRecord {
  return {
    ...input,
    pullRequestNumber: input.pullRequestNumber ?? null,
    pullRequestUrl: input.pullRequestUrl ?? null,
    mergedSha: input.mergedSha ?? null,
    failureMessage: input.failureMessage ?? null,
    updatedAt: new Date().toISOString(),
  };
}

export async function markTenkiRunnerWorkflowSetupPreparing(input: {
  orgId: string;
  repository: string;
  workflowPath: string;
}): Promise<void> {
  if (workspacePersistenceMode(input.orgId) === "memory") {
    memorySetups().set(key(input.orgId, input.repository), memoryRecord({
      ...input,
      status: "Preparing",
    }));
    return;
  }
  await databasePool().query(
    `INSERT INTO tenki_runner_workflow_setups(
       id,org_id,repository,workflow_path,status
     ) VALUES($1,$2,$3,$4,'Preparing')
     ON CONFLICT (org_id,repository) DO UPDATE SET
       workflow_path=EXCLUDED.workflow_path,
       pull_request_number=NULL,pull_request_url=NULL,
       status='Preparing',merged_sha=NULL,failure_message=NULL,updated_at=now()`,
    [randomUUID(), input.orgId, input.repository, input.workflowPath],
  );
}

export async function markTenkiRunnerWorkflowSetupFailed(input: {
  orgId: string;
  repository: string;
  workflowPath: string;
  failureMessage: string;
}): Promise<void> {
  if (workspacePersistenceMode(input.orgId) === "memory") {
    const prior = memorySetups().get(key(input.orgId, input.repository));
    memorySetups().set(key(input.orgId, input.repository), memoryRecord({
      ...input,
      status: "Failed",
      pullRequestNumber: prior?.pullRequestNumber,
      pullRequestUrl: prior?.pullRequestUrl,
    }));
    return;
  }
  await databasePool().query(
    `INSERT INTO tenki_runner_workflow_setups(
       id,org_id,repository,workflow_path,status,failure_message
     ) VALUES($1,$2,$3,$4,'Failed',$5)
     ON CONFLICT (org_id,repository) DO UPDATE SET
       workflow_path=EXCLUDED.workflow_path,status='Failed',
       failure_message=EXCLUDED.failure_message,updated_at=now()`,
    [randomUUID(), input.orgId, input.repository, input.workflowPath, input.failureMessage],
  );
}

export async function savePendingTenkiRunnerWorkflowSetup(input: {
  orgId: string;
  repository: string;
  workflowPath: string;
  pullRequestNumber: number;
  pullRequestUrl: string;
}): Promise<void> {
  if (workspacePersistenceMode(input.orgId) === "memory") {
    memorySetups().set(key(input.orgId, input.repository), memoryRecord({
      ...input,
      status: "Pending",
    }));
    return;
  }
  await databasePool().query(
    `INSERT INTO tenki_runner_workflow_setups(
       id,org_id,repository,workflow_path,pull_request_number,
       pull_request_url,status
     ) VALUES($1,$2,$3,$4,$5,$6,'Pending')
     ON CONFLICT (org_id,repository) DO UPDATE SET
       workflow_path=EXCLUDED.workflow_path,
       pull_request_number=EXCLUDED.pull_request_number,
       pull_request_url=EXCLUDED.pull_request_url,
       status='Pending',merged_sha=NULL,failure_message=NULL,updated_at=now()`,
    [
      randomUUID(),
      input.orgId,
      input.repository,
      input.workflowPath,
      input.pullRequestNumber,
      input.pullRequestUrl,
    ],
  );
}

export async function markTenkiRunnerWorkflowSetupInstalled(input: {
  orgId: string;
  repository: string;
  workflowPath: string;
  pullRequestNumber: number | null;
  pullRequestUrl: string | null;
  mergedSha: string;
}): Promise<void> {
  if (workspacePersistenceMode(input.orgId) === "memory") {
    memorySetups().set(key(input.orgId, input.repository), memoryRecord({
      ...input,
      status: "Installed",
    }));
    return;
  }
  await databasePool().query(
    `INSERT INTO tenki_runner_workflow_setups(
       id,org_id,repository,workflow_path,pull_request_number,
       pull_request_url,status,merged_sha
     ) VALUES($1,$2,$3,$4,$5,$6,'Installed',$7)
     ON CONFLICT (org_id,repository) DO UPDATE SET
       workflow_path=EXCLUDED.workflow_path,
       pull_request_number=EXCLUDED.pull_request_number,
       pull_request_url=COALESCE(EXCLUDED.pull_request_url,tenki_runner_workflow_setups.pull_request_url),
       status='Installed',merged_sha=EXCLUDED.merged_sha,
       failure_message=NULL,updated_at=now()`,
    [
      randomUUID(),
      input.orgId,
      input.repository,
      input.workflowPath,
      input.pullRequestNumber,
      input.pullRequestUrl,
      input.mergedSha,
    ],
  );
}

function setupView(record: SetupRecord): TenkiRunnerWorkflowSetupView {
  return {
    repository: record.repository,
    workflowPath: record.workflowPath,
    pullRequestNumber: record.pullRequestNumber,
    pullRequestUrl: record.pullRequestUrl,
    status: record.status,
    mergedSha: record.mergedSha,
    failureMessage: record.failureMessage,
    updatedAt: record.updatedAt,
  };
}

export async function getTenkiRunnerWorkflowSetup(
  orgId: string,
  repository: string,
): Promise<TenkiRunnerWorkflowSetupView | null> {
  if (workspacePersistenceMode(orgId) === "memory") {
    const record = memorySetups().get(key(orgId, repository));
    return record ? setupView(record) : null;
  }
  const result = await databasePool().query<{
    repository: string;
    workflow_path: string;
    pull_request_number: number | null;
    pull_request_url: string | null;
    status: TenkiRunnerWorkflowSetupStatus;
    merged_sha: string | null;
    failure_message: string | null;
    updated_at: Date;
  }>(
    `SELECT repository,workflow_path,pull_request_number,pull_request_url,status,
            merged_sha,failure_message,updated_at
       FROM tenki_runner_workflow_setups
      WHERE org_id=$1 AND repository=$2`,
    [orgId, repository],
  );
  const row = result.rows[0];
  return row ? {
    repository: row.repository,
    workflowPath: row.workflow_path,
    pullRequestNumber: row.pull_request_number,
    pullRequestUrl: row.pull_request_url,
    status: row.status,
    mergedSha: row.merged_sha,
    failureMessage: row.failure_message,
    updatedAt: row.updated_at.toISOString(),
  } : null;
}

export async function listTenkiRunnerWorkflowSetups(
  orgId: string,
): Promise<TenkiRunnerWorkflowSetupView[]> {
  if (workspacePersistenceMode(orgId) === "memory") {
    return [...memorySetups().values()]
      .filter((record) => record.orgId === orgId)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .map(setupView);
  }
  const result = await databasePool().query<{
    repository: string;
    workflow_path: string;
    pull_request_number: number | null;
    pull_request_url: string | null;
    status: TenkiRunnerWorkflowSetupStatus;
    merged_sha: string | null;
    failure_message: string | null;
    updated_at: Date;
  }>(
    `SELECT repository,workflow_path,pull_request_number,pull_request_url,status,
            merged_sha,failure_message,updated_at
       FROM tenki_runner_workflow_setups
      WHERE org_id=$1 ORDER BY updated_at DESC`,
    [orgId],
  );
  return result.rows.map((row) => ({
    repository: row.repository,
    workflowPath: row.workflow_path,
    pullRequestNumber: row.pull_request_number,
    pullRequestUrl: row.pull_request_url,
    status: row.status,
    mergedSha: row.merged_sha,
    failureMessage: row.failure_message,
    updatedAt: row.updated_at.toISOString(),
  }));
}

export async function listPendingTenkiRunnerWorkflowSetups(
  orgId: string,
): Promise<PendingTenkiRunnerWorkflowSetup[]> {
  if (workspacePersistenceMode(orgId) === "memory") {
    return [...memorySetups().values()]
      .filter((record) => record.orgId === orgId && record.status === "Pending")
      .map((record) => ({
        repository: record.repository,
        workflowPath: record.workflowPath,
        pullRequestNumber: record.pullRequestNumber!,
        pullRequestUrl: record.pullRequestUrl!,
        updatedAt: record.updatedAt,
      }));
  }
  const result = await databasePool().query<{
    repository: string;
    workflow_path: string;
    pull_request_number: number;
    pull_request_url: string;
    updated_at: Date;
  }>(
    `SELECT repository,workflow_path,pull_request_number,pull_request_url,updated_at
       FROM tenki_runner_workflow_setups
      WHERE org_id=$1 AND status='Pending'
      ORDER BY updated_at DESC`,
    [orgId],
  );
  return result.rows.map((row) => ({
    repository: row.repository,
    workflowPath: row.workflow_path,
    pullRequestNumber: row.pull_request_number,
    pullRequestUrl: row.pull_request_url,
    updatedAt: row.updated_at.toISOString(),
  }));
}

export async function assertTenkiRunnerWorkflowSetupInstalled(
  orgId: string,
  repository: string,
): Promise<void> {
  const setup = await getTenkiRunnerWorkflowSetup(orgId, repository);
  if (setup?.status === "Installed") return;
  if (setup?.status === "Pending") {
    throw new Error("Approve and merge the Tenki setup pull request before running execution");
  }
  if (setup?.status === "Preparing") {
    throw new Error("CloseSpan is still preparing the Tenki runtime verifier workflow");
  }
  throw new Error(
    setup?.failureMessage
      ? `Tenki setup needs attention: ${setup.failureMessage}`
      : "Runtime verifier workflow is not installed. Approve the Tenki setup pull request before running verification.",
  );
}

export function resetMemoryTenkiRunnerWorkflowSetups(): void {
  memorySetups().clear();
}
