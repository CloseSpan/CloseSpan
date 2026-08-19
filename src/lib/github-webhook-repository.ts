import { createHash, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { databasePool, transaction } from "./db";
import {
  createGithubInstallationClient,
  verifyGithubInstallation,
  type VerifiedGithubInstallation,
} from "./github-app-auth";
import { syncGithubInstallationRecords } from "./github-installation-repository";
import { githubRuntimeVerificationFailureMessage } from "./runtime-verifier-errors";
import {
  recordGithubDeploymentStatus,
  type GithubDeploymentPayload,
} from "./release-lifecycle-repository";

interface GithubWebhookPayload extends GithubDeploymentPayload {
  action?: unknown;
  installation?: { id?: unknown };
  repository?: { full_name?: unknown };
  workflow_run?: {
    id?: unknown;
    name?: unknown;
    display_title?: unknown;
    event?: unknown;
    status?: unknown;
    conclusion?: unknown;
    html_url?: unknown;
    head_branch?: unknown;
    head_sha?: unknown;
  };
  pull_request?: {
    number?: unknown;
    html_url?: unknown;
    merged?: unknown;
    draft?: unknown;
    merge_commit_sha?: unknown;
    head?: { sha?: unknown };
    base?: { ref?: unknown };
  };
}

export interface GithubWebhookInput {
  deliveryId: string;
  event: string;
  rawBody: string;
  payload: GithubWebhookPayload;
}

export interface GithubWebhookResult {
  accepted: true;
  duplicate: boolean;
  outcome: string;
}

const synchronizationActions = new Set([
  "created",
  "new_permissions_accepted",
  "target_renamed",
  "unsuspend",
]);
const pullRequestActions = new Set([
  "opened",
  "reopened",
  "synchronize",
  "ready_for_review",
  "converted_to_draft",
  "closed",
]);
const runtimeVerificationTitle = /^CloseSpan verification ([0-9a-f]{8}-[0-9a-f-]{27})$/i;
const closespanRunBranch = /^closespan\/runs\/([0-9a-f]{8}-[0-9a-f-]{27})$/i;

let schemaInitialization: Promise<void> | undefined;

async function ensureGithubWebhookSchema(): Promise<void> {
  schemaInitialization ??= databasePool()
    .query(`
      CREATE TABLE IF NOT EXISTS github_webhook_deliveries (
        delivery_id uuid PRIMARY KEY,
        event text NOT NULL,
        action text,
        installation_id bigint,
        org_id text REFERENCES organizations(id) ON DELETE SET NULL,
        payload_sha256 text NOT NULL CHECK (payload_sha256 ~ '^[a-f0-9]{64}$'),
        outcome text NOT NULL,
        received_at timestamptz NOT NULL DEFAULT now(),
        processed_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS github_webhook_deliveries_org_time_idx
        ON github_webhook_deliveries(org_id,received_at DESC);
      CREATE INDEX IF NOT EXISTS github_webhook_deliveries_installation_time_idx
        ON github_webhook_deliveries(installation_id,received_at DESC)
        WHERE installation_id IS NOT NULL;
      CREATE TABLE IF NOT EXISTS github_webhook_delivery_workspaces (
        delivery_id uuid NOT NULL
          REFERENCES github_webhook_deliveries(delivery_id) ON DELETE CASCADE,
        org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        outcome text NOT NULL,
        processed_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (delivery_id,org_id)
      );
      CREATE INDEX IF NOT EXISTS github_webhook_delivery_workspaces_org_time_idx
        ON github_webhook_delivery_workspaces(org_id,processed_at DESC);
    `)
    .then(() => undefined)
    .catch((error: unknown) => {
      schemaInitialization = undefined;
      throw error;
    });
  await schemaInitialization;
}

function stringAction(payload: GithubWebhookPayload): string | null {
  return typeof payload.action === "string" && /^[a-z][a-z0-9_]{0,63}$/.test(payload.action)
    ? payload.action
    : null;
}

function installationId(payload: GithubWebhookPayload): string | null {
  const value = payload.installation?.id;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) return null;
  return String(value);
}

async function installationOrganizations(id: string | null): Promise<string[]> {
  if (!id) return [];
  const result = await databasePool().query<{ org_id: string }>(
    `SELECT org_id FROM github_app_installations
      WHERE installation_id=$1 AND workspace_connected=true
      ORDER BY org_id`,
    [id],
  );
  return [...new Set(result.rows.map((row) => row.org_id))];
}

async function deactivateInstallation(
  client: PoolClient,
  orgId: string,
  id: string,
  action: string,
  deliveryId: string,
): Promise<string> {
  const changed = await client.query(
    `UPDATE github_app_installations
        SET active=false,updated_at=now()
      WHERE org_id=$1 AND installation_id=$2 AND active=true
      RETURNING id`,
    [orgId, id],
  );
  await client.query(
    `UPDATE github_repository_allowlists
        SET active=false,updated_at=now()
      WHERE org_id=$1 AND installation_id=$2 AND active=true`,
    [orgId, id],
  );
  await client.query(
    `UPDATE integrations
        SET connection_state='Not connected',last_sync_at=now(),
            data_scope='None',permissions='[]'::jsonb,
            error_message=$2
      WHERE org_id=$1 AND id='int_github'
        AND NOT EXISTS (
          SELECT 1 FROM github_app_installations
           WHERE org_id=$1 AND active=true
        )`,
    [orgId, action === "suspend" ? "GitHub App installation suspended" : null],
  );
  if (changed.rowCount) {
    await client.query(
      `INSERT INTO audit_events(
         id,org_id,actor_id,actor_name,action,entity_type,entity_id,trace_id
       ) VALUES($1,$2,'github','GitHub',$3,'Integration','int_github',$4)`,
      [
        randomUUID(),
        orgId,
        action === "suspend"
          ? `GitHub App installation ${id} was suspended`
          : `GitHub App installation ${id} was removed`,
        `github-webhook-${deliveryId}`,
      ],
    );
  }
  return changed.rowCount ? `installation_${action}` : "installation_already_inactive";
}

async function synchronizeInstallation(
  client: PoolClient,
  orgId: string,
  verified: VerifiedGithubInstallation,
  deliveryId: string,
): Promise<string> {
  const binding = await client.query(
    `SELECT 1 FROM github_app_installations
      WHERE org_id=$1 AND installation_id=$2 FOR UPDATE`,
    [orgId, verified.installationId],
  );
  if (!binding.rowCount) return "ignored_unbound_installation";
  await syncGithubInstallationRecords(client, orgId, verified, {
    preserveWorkspaceRepositoryBindings: true,
  });
  await client.query(
    `INSERT INTO audit_events(
       id,org_id,actor_id,actor_name,action,entity_type,entity_id,trace_id
     ) VALUES($1,$2,'github','GitHub',$3,'Integration','int_github',$4)`,
    [
      randomUUID(),
      orgId,
      `Synchronized GitHub App installation ${verified.installationId} with ${verified.repositories.length} repositories`,
      `github-webhook-${deliveryId}`,
    ],
  );
  return "installation_synchronized";
}

async function auditPullRequest(
  client: PoolClient,
  orgId: string,
  id: string,
  action: string | null,
  payload: GithubWebhookPayload,
  deliveryId: string,
): Promise<string> {
  if (!action || !pullRequestActions.has(action)) return "ignored_pull_request_action";
  const repository = payload.repository?.full_name;
  const number = payload.pull_request?.number;
  if (typeof repository !== "string" || typeof number !== "number" || !Number.isSafeInteger(number))
    return "ignored_malformed_pull_request";
  const run = await client.query<{ id: string; problem_id: string }>(
    `SELECT run.id,run.problem_id
       FROM agent_runs run
       JOIN github_repository_allowlists allowlist
         ON allowlist.org_id=run.org_id
        AND allowlist.repository=run.repository
        AND allowlist.installation_id=$2
        AND allowlist.active=true
      WHERE run.org_id=$1 AND run.repository=$3
        AND run.pull_request_number=$4
      ORDER BY run.queued_at DESC LIMIT 1`,
    [orgId, id, repository, number],
  );
  const trackedRun = run.rows[0];
  const runId = trackedRun?.id;
  if (!trackedRun || !runId) return "ignored_untracked_pull_request";
  const merged = action === "closed" && payload.pull_request?.merged === true;
  const headSha = payload.pull_request?.head?.sha;
  if (action === "synchronize" && typeof headSha === "string") {
    await client.query(
      `UPDATE approval_requests
          SET status='Superseded',updated_at=now()
        WHERE org_id=$1 AND agent_run_id=$2 AND action_type='final_execution'
          AND status='Pending' AND head_sha<>$3`,
      [orgId, runId, headSha],
    );
  }
  if (merged) {
    const mergeSha = payload.pull_request?.merge_commit_sha;
    await client.query(
      `UPDATE final_execution_attempts
          SET status='Succeeded',result_sha=coalesce($3,result_sha),completed_at=coalesce(completed_at,now())
        WHERE org_id=$1 AND agent_run_id=$2 AND status IN ('Queued','Running')`,
      [orgId, runId, typeof mergeSha === "string" ? mergeSha : null],
    );
    const transitioned = await client.query(
      `UPDATE product_problems
          SET stage='Release Ready',updated_at=now()
        WHERE org_id=$1 AND id=$2
          AND stage IN ('Approved','Planned','In progress')
        RETURNING id`,
      [orgId, trackedRun.problem_id],
    );
    await client.query(
      `UPDATE engineering_ticket_specifications
          SET implementation_state='Release Ready',updated_at=now()
        WHERE org_id=$1 AND problem_id=$2
          AND implementation_state NOT IN ('Released','Verified')`,
      [orgId, trackedRun.problem_id],
    );
    if (transitioned.rowCount) {
      await client.query(
        `UPDATE workspaces SET version=version+1,updated_at=now() WHERE org_id=$1`,
        [orgId],
      );
      await client.query(
        `INSERT INTO audit_events(
           id,org_id,actor_id,actor_name,action,entity_type,entity_id,trace_id
         ) VALUES($1,$2,'github','GitHub',$3,'ProductProblem',$4,$5)`,
        [
          randomUUID(),
          orgId,
          `Moved problem to Release Ready after ${repository}#${number} merged`,
          trackedRun.problem_id,
          `github-webhook-${deliveryId}`,
        ],
      );
    }
  }
  const description = merged ? "merged" : action === "closed" ? "closed without merge" : action.replaceAll("_", " ");
  await client.query(
    `INSERT INTO audit_events(
       id,org_id,actor_id,actor_name,action,entity_type,entity_id,trace_id
     ) VALUES($1,$2,'github','GitHub',$3,'Agent run',$4,$5)`,
    [
      randomUUID(),
      orgId,
      `GitHub draft PR ${repository}#${number} ${description}`,
      runId,
      `github-webhook-${deliveryId}`,
    ],
  );
  return merged ? "tracked_pull_request_merged" : `tracked_pull_request_${action}`;
}

function runtimeVerificationRunId(payload: GithubWebhookPayload): string | null {
  const title = payload.workflow_run?.display_title;
  const titleMatch = typeof title === "string" ? runtimeVerificationTitle.exec(title) : null;
  if (titleMatch?.[1]) return titleMatch[1].toLowerCase();
  const branch = payload.workflow_run?.head_branch;
  const branchMatch = typeof branch === "string"
    ? closespanRunBranch.exec(branch)
    : null;
  return branchMatch?.[1]?.toLowerCase() ?? null;
}

function agentRunId(payload: GithubWebhookPayload): string | null {
  const branch = payload.workflow_run?.head_branch;
  const match = typeof branch === "string" ? closespanRunBranch.exec(branch) : null;
  return match?.[1]?.toLowerCase() ?? null;
}

async function reconcileAgentWorkflow(
  client: PoolClient,
  orgId: string,
  installationId: string,
  action: string | null,
  payload: GithubWebhookPayload,
  deliveryId: string,
): Promise<string> {
  const workflow = payload.workflow_run;
  if (action !== "completed" || workflow?.name !== "CloseSpan approval-bound agent") {
    return "ignored_agent_workflow_action";
  }
  const runId = agentRunId(payload);
  const repository = payload.repository?.full_name;
  if (!runId || typeof repository !== "string") return "ignored_malformed_agent_workflow";

  const tracked = await client.query<{
    problem_id: string;
    prompt_revision_id: string;
    status: string;
  }>(
    `SELECT run.problem_id,run.prompt_revision_id,run.status
       FROM agent_runs run
       JOIN github_repository_allowlists allowlist
         ON allowlist.org_id=run.org_id
        AND allowlist.repository=run.repository
        AND allowlist.installation_id=$3
        AND allowlist.active=true
      WHERE run.org_id=$1 AND run.id=$2 AND run.repository=$4
      FOR UPDATE`,
    [orgId, runId, installationId, repository],
  );
  const record = tracked.rows[0];
  if (!record) return "ignored_untracked_agent_workflow";
  if (["Draft PR opened", "Failed", "Cancelled", "No changes"].includes(record.status)) {
    return "agent_workflow_already_terminal";
  }

  const conclusion = typeof workflow.conclusion === "string"
    ? workflow.conclusion.replaceAll("_", " ")
    : "without a result";
  const workflowUrl = typeof workflow.html_url === "string" ? workflow.html_url : null;
  const message = workflow.conclusion === "success"
    ? "GitHub Actions completed, but CloseSpan did not receive the implementation report. Review the GitHub run, then prepare another coding run."
    : `GitHub Actions ${conclusion} before CloseSpan received the implementation report. Review the GitHub run, resolve the account, runner, or workflow failure, then prepare another coding run.`;
  const status = workflow.conclusion === "cancelled" ? "Cancelled" : "Failed";
  const failureCode = `github_workflow_${typeof workflow.conclusion === "string" ? workflow.conclusion : "unknown"}`;
  const failureMessage = workflowUrl ? `${message} ${workflowUrl}` : message;

  const updated = await client.query(
    `UPDATE agent_runs
        SET status=$3,failure_code=$4,failure_message=$5,completed_at=coalesce(completed_at,now())
      WHERE org_id=$1 AND id=$2 AND status IN ('Queued','Running','Tests passed')`,
    [orgId, runId, status, failureCode.slice(0, 120), failureMessage.slice(0, 2_000)],
  );
  if (!updated.rowCount) return "agent_workflow_already_terminal";
  await client.query(
    "UPDATE engineering_ticket_specifications SET implementation_state='Prompt ready',updated_at=now() WHERE org_id=$1 AND problem_id=$2",
    [orgId, record.problem_id],
  );
  await client.query(
    "UPDATE implementation_prompts SET status='Ready' WHERE org_id=$1 AND id=$2 AND status='Approved'",
    [orgId, record.prompt_revision_id],
  );
  await client.query(
    `INSERT INTO audit_events(
       id,org_id,actor_id,actor_name,action,entity_type,entity_id,trace_id
     ) VALUES($1,$2,'github','GitHub Actions',$3,'AgentRun',$4,$5)`,
    [randomUUID(), orgId, failureMessage, runId, `github-webhook-${deliveryId}`],
  );
  return "agent_workflow_failed_from_github_workflow";
}

async function reconcileRuntimeVerificationWorkflow(
  client: PoolClient,
  orgId: string,
  installationId: string,
  action: string | null,
  payload: GithubWebhookPayload,
  deliveryId: string,
  resolvedFailureMessage: string | null,
): Promise<string> {
  const workflow = payload.workflow_run;
  if (action !== "completed" || workflow?.name !== "CloseSpan current-issue verifier") {
    return "ignored_runtime_verification_workflow_action";
  }
  const runId = runtimeVerificationRunId(payload);
  const repository = payload.repository?.full_name;
  const workflowRunId = workflow.id;
  const headSha = workflow.head_sha;
  if (
    !runId
    || typeof repository !== "string"
    || typeof workflowRunId !== "number"
    || !Number.isSafeInteger(workflowRunId)
    || typeof headSha !== "string"
  ) return "ignored_malformed_runtime_verification_workflow";

  const tracked = await client.query<{ investigation_id: string; status: string }>(
    `SELECT run.investigation_id,run.status
       FROM issue_runtime_verification_runs run
       JOIN github_repository_allowlists allowlist
         ON allowlist.org_id=run.org_id
        AND allowlist.repository=run.repository
        AND allowlist.installation_id=$3
        AND allowlist.active=true
      WHERE run.org_id=$1 AND run.id=$2 AND run.repository=$4
        AND lower(run.base_sha)=lower($5)
      FOR UPDATE`,
    [orgId, runId, installationId, repository, headSha],
  );
  const record = tracked.rows[0];
  if (!record) return "ignored_untracked_runtime_verification_workflow";
  if (record.status === "Completed" || record.status === "Failed") {
    await client.query(
      `UPDATE issue_runtime_verification_runs
          SET workflow_run_id=coalesce(workflow_run_id,$3),updated_at=now()
        WHERE org_id=$1 AND id=$2`,
      [orgId, runId, workflowRunId],
    );
    return "runtime_verification_already_terminal";
  }

  const conclusion = typeof workflow.conclusion === "string"
    ? workflow.conclusion.replaceAll("_", " ")
    : "without a result";
  const message = resolvedFailureMessage ?? (workflow.conclusion === "success"
    ? "GitHub Actions completed, but CloseSpan did not receive the runtime verification result. Review the GitHub run, then retry."
    : `GitHub Actions ${conclusion} before CloseSpan received a runtime verification result. Review the GitHub run, correct the failure, then retry.`);
  await client.query(
    `UPDATE issue_runtime_verification_runs
        SET status='Failed',outcome='Verification blocked',summary=$4,failure_message=$4,
            workflow_run_id=$3,completed_at=coalesce(completed_at,now()),updated_at=now()
      WHERE org_id=$1 AND id=$2 AND status IN ('Queued','Running')`,
    [orgId, runId, workflowRunId, message],
  );
  await client.query(
    `UPDATE investigations
        SET verification_status='Verification blocked',verification_method='Automated check',
            verification_summary=$3,verification_actor_id='github',verification_actor_name='GitHub Actions',
            verified_at=now(),updated_at=now()
      WHERE org_id=$1 AND id=$2`,
    [orgId, record.investigation_id, message],
  );
  await client.query(
    `INSERT INTO audit_events(
       id,org_id,actor_id,actor_name,action,entity_type,entity_id,trace_id
     ) VALUES($1,$2,'github','GitHub Actions',$3,'Investigation',$4,$5)`,
    [randomUUID(), orgId, message, record.investigation_id, `github-webhook-${deliveryId}`],
  );
  return "runtime_verification_failed_from_github_workflow";
}

function summarizeWorkspaceOutcomes(outcomes: string[]): string {
  if (outcomes.length === 0) return "ignored_unbound_installation";
  if (outcomes.length === 1) return outcomes[0];
  if (outcomes.every((outcome) => outcome === outcomes[0]))
    return `${outcomes[0]}_for_${outcomes.length}_workspaces`;
  return `processed_${outcomes.length}_workspaces`;
}

async function recordWorkspaceOutcome(
  client: PoolClient,
  deliveryId: string,
  orgId: string,
  outcome: string,
): Promise<void> {
  await client.query(
    `INSERT INTO github_webhook_delivery_workspaces(delivery_id,org_id,outcome)
     VALUES($1,$2,$3)
     ON CONFLICT(delivery_id,org_id) DO UPDATE SET
       outcome=excluded.outcome,processed_at=now()`,
    [deliveryId, orgId, outcome],
  );
}

async function processWorkspaceEvent(
  client: PoolClient,
  orgId: string,
  id: string,
  action: string | null,
  input: GithubWebhookInput,
  verified: VerifiedGithubInstallation | null,
  runtimeFailureMessage: string | null,
): Promise<string> {
  if (input.event === "installation" && (action === "deleted" || action === "suspend"))
    return deactivateInstallation(client, orgId, id, action, input.deliveryId);
  if (verified)
    return synchronizeInstallation(client, orgId, verified, input.deliveryId);
  if (input.event === "pull_request")
    return auditPullRequest(client, orgId, id, action, input.payload, input.deliveryId);
  if (input.event === "workflow_run") {
    if (input.payload.workflow_run?.name === "CloseSpan approval-bound agent") {
      return reconcileAgentWorkflow(
        client,
        orgId,
        id,
        action,
        input.payload,
        input.deliveryId,
      );
    }
    return reconcileRuntimeVerificationWorkflow(
      client,
      orgId,
      id,
      action,
      input.payload,
      input.deliveryId,
      runtimeFailureMessage,
    );
  }
  if (input.event === "deployment_status")
    return recordGithubDeploymentStatus(client, orgId, input.deliveryId, input.payload);
  return "ignored_unhandled_event";
}

export async function processGithubWebhook(
  input: GithubWebhookInput,
): Promise<GithubWebhookResult> {
  await ensureGithubWebhookSchema();
  const existingDelivery = await databasePool().query(
    "SELECT 1 FROM github_webhook_deliveries WHERE delivery_id=$1",
    [input.deliveryId],
  );
  if (existingDelivery.rowCount)
    return { accepted: true, duplicate: true, outcome: "duplicate" };

  const action = stringAction(input.payload);
  const id = installationId(input.payload);
  const orgIds = await installationOrganizations(id);

  let verified: VerifiedGithubInstallation | null = null;
  const shouldSynchronize = Boolean(
    orgIds.length && id && (
      input.event === "installation_repositories" ||
      (input.event === "installation" && action && synchronizationActions.has(action))
    ),
  );
  if (shouldSynchronize && id) verified = await verifyGithubInstallation(id);

  let runtimeFailureMessage: string | null = null;
  const workflow = input.payload.workflow_run;
  const repository = input.payload.repository?.full_name;
  if (
    id
    && orgIds.length > 0
    && input.event === "workflow_run"
    && action === "completed"
    && workflow?.name === "CloseSpan current-issue verifier"
    && workflow.conclusion !== "success"
    && typeof workflow.id === "number"
    && Number.isSafeInteger(workflow.id)
    && typeof repository === "string"
  ) {
    const [owner, repo] = repository.split("/");
    if (owner && repo) {
      try {
        const github = await createGithubInstallationClient(id);
        runtimeFailureMessage = await githubRuntimeVerificationFailureMessage(
          github,
          owner,
          repo,
          workflow.id,
        );
      } catch {
        // The webhook still records a terminal result when GitHub diagnostics are unavailable.
      }
    }
  }

  return transaction(async (client) => {
    const inserted = await client.query(
      `INSERT INTO github_webhook_deliveries(
         delivery_id,event,action,installation_id,org_id,payload_sha256,outcome
       ) VALUES($1,$2,$3,$4,$5,$6,'processing')
       ON CONFLICT(delivery_id) DO NOTHING
       RETURNING delivery_id`,
      [
        input.deliveryId,
        input.event,
        action,
        id,
        orgIds.length === 1 ? orgIds[0] : null,
        createHash("sha256").update(input.rawBody, "utf8").digest("hex"),
      ],
    );
    if (!inserted.rowCount)
      return { accepted: true, duplicate: true, outcome: "duplicate" };

    let outcome = "ignored_unhandled_event";
    if (input.event === "ping") outcome = "ping_acknowledged";
    else if (!id) outcome = "ignored_missing_installation";
    else if (!orgIds.length) outcome = "ignored_unbound_installation";
    else {
      const workspaceOutcomes: string[] = [];
      for (const orgId of orgIds) {
        const workspaceOutcome = await processWorkspaceEvent(
          client,
          orgId,
          id,
          action,
          input,
          verified,
          runtimeFailureMessage,
        );
        await recordWorkspaceOutcome(client, input.deliveryId, orgId, workspaceOutcome);
        workspaceOutcomes.push(workspaceOutcome);
      }
      outcome = summarizeWorkspaceOutcomes(workspaceOutcomes);
    }

    await client.query(
      `UPDATE github_webhook_deliveries
          SET outcome=$2,processed_at=now()
        WHERE delivery_id=$1`,
      [input.deliveryId, outcome],
    );
    return { accepted: true, duplicate: false, outcome };
  });
}
