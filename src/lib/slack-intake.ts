import { createHash, randomUUID } from "node:crypto";
import { getAiRuntimeConfiguration } from "./ai-config";
import {
  completeModelRun,
  failModelRun,
  getFeedbackAnalysisContext,
  reserveModelRun,
} from "./ai-repository";
import { analyzeFeedbackWithProvider } from "./ai-provider";
import { databasePool, transaction } from "./db";
import { reviewLatestFeedbackAnalysis } from "./feedback-review-repository";
import { redactUntrustedText } from "./redaction";
import { hasExplicitMalfunctionSignal } from "./feedback-classification";
import {
  createPublicSlackChannel,
  findPublicSlackChannel,
  getSlackTeam,
  listSlackChannelMessages,
  listSlackThreadReplies,
  postSlackMessage,
  setSlackChannelPurpose,
  type SlackFile,
  type SlackMessage,
  type SlackReaction,
  type SlackProxyContext,
} from "./slack-api";
import { workspacePersistenceMode } from "./workspace-persistence";

export const SLACK_INTAKE_CHANNEL = "closespan-feedback";
export const SLACK_INTAKE_WELCOME_TEXT =
  "CloseSpan is listening in #closespan-feedback. Messages, thread replies, reactions, and attachment metadata posted from now on can become customer signals. CloseSpan creates one thread per Product Problem and asks for human action only when approval, scope changes, or release verification is required.";
const MAX_THREAD_FETCHES_PER_TICK = 25;
const MAX_SIGNAL_TEXT = 8_000;

export interface SlackIntakeStatus {
  state: "Connected" | "Needs reconnect" | "Disconnected" | "Error";
  accountId: string;
  teamId: string;
  teamName: string | null;
  channelId: string;
  channelName: string;
  lastPolledAt: string | null;
  lastError: string | null;
}

interface SlackIntakeRow {
  org_id: string;
  account_id: string;
  team_id: string;
  team_name: string | null;
  channel_id: string;
  channel_name: string;
  state: SlackIntakeStatus["state"];
  cursor_ts: string;
  welcome_message_ts: string | null;
  last_polled_at: Date | null;
  last_error: string | null;
}

type SlackNotificationEvent =
  | "problem_detected"
  | "approval_required"
  | "run_blocked"
  | "draft_pr_opened"
  | "released"
  | "verification_required"
  | "verified";

function timestampNow(): string {
  return `${Math.floor(Date.now() / 1_000)}.000000`;
}

function timestampNumber(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function rowToStatus(row: SlackIntakeRow): SlackIntakeStatus {
  return {
    state: row.state,
    accountId: row.account_id,
    teamId: row.team_id,
    teamName: row.team_name,
    channelId: row.channel_id,
    channelName: row.channel_name,
    lastPolledAt: row.last_polled_at?.toISOString() ?? null,
    lastError: row.last_error,
  };
}

export async function getSlackIntakeStatus(
  orgId: string,
): Promise<SlackIntakeStatus | null> {
  if (workspacePersistenceMode(orgId) !== "postgres") return null;
  const result = await databasePool().query<SlackIntakeRow>(
    `SELECT org_id,account_id,team_id,team_name,channel_id,channel_name,state,
            cursor_ts,welcome_message_ts,last_polled_at,last_error
       FROM slack_intake_connections WHERE org_id=$1`,
    [orgId],
  );
  return result.rows[0] ? rowToStatus(result.rows[0]) : null;
}

async function getSlackIntakeRow(orgId: string): Promise<SlackIntakeRow | null> {
  const result = await databasePool().query<SlackIntakeRow>(
    `SELECT org_id,account_id,team_id,team_name,channel_id,channel_name,state,
            cursor_ts,welcome_message_ts,last_polled_at,last_error
       FROM slack_intake_connections WHERE org_id=$1`,
    [orgId],
  );
  return result.rows[0] ?? null;
}

export async function ensureSlackIntakeChannel(input: {
  orgId: string;
  accountId: string;
  actorId: string;
  actorName: string;
  traceId: string;
}): Promise<SlackIntakeStatus> {
  if (workspacePersistenceMode(input.orgId) !== "postgres")
    throw new Error("Slack intake requires PostgreSQL persistence.");

  const previous = await getSlackIntakeRow(input.orgId);
  if (
    previous?.account_id === input.accountId &&
    previous.state === "Connected"
  ) {
    return rowToStatus(previous);
  }

  const context: SlackProxyContext = {
    orgId: input.orgId,
    accountId: input.accountId,
  };
  const team = await getSlackTeam(context);
  const existing = await findPublicSlackChannel(
    context,
    SLACK_INTAKE_CHANNEL,
  );
  const channel = existing ?? await createPublicSlackChannel(
    context,
    SLACK_INTAKE_CHANNEL,
  );
  await setSlackChannelPurpose(context, channel.id);

  const cursor = previous?.cursor_ts ?? timestampNow();
  await transaction(async (client) => {
    await client.query(
      `INSERT INTO slack_intake_connections(
         org_id,account_id,team_id,team_name,channel_id,channel_name,state,
         cursor_ts,connected_by,last_error
       ) VALUES($1,$2,$3,$4,$5,$6,'Connected',$7,$8,NULL)
       ON CONFLICT(org_id) DO UPDATE SET
         account_id=excluded.account_id,team_id=excluded.team_id,
         team_name=excluded.team_name,channel_id=excluded.channel_id,
         channel_name=excluded.channel_name,state='Connected',
         last_error=NULL,updated_at=now()`,
      [
        input.orgId,
        input.accountId,
        team.id,
        team.name,
        channel.id,
        SLACK_INTAKE_CHANNEL,
        cursor,
        input.actorId,
      ],
    );
    await client.query(
      `INSERT INTO audit_events(
         id,org_id,actor_id,actor_name,action,entity_type,entity_id,trace_id
       ) VALUES($1,$2,$3,$4,$5,'SlackIntake',$6,$7)
       ON CONFLICT(org_id,trace_id,action) DO NOTHING`,
      [
        randomUUID(),
        input.orgId,
        input.actorId,
        input.actorName,
        `${existing ? "Adopted" : "Created"} #${SLACK_INTAKE_CHANNEL} for automated feedback intake`,
        channel.id,
        input.traceId,
      ],
    );
  });

  const current = await getSlackIntakeRow(input.orgId);
  if (!current?.welcome_message_ts) {
    const recent = await listSlackChannelMessages(context, channel.id, "0");
    const existingWelcome = recent.find(
      (message) => message.text?.trim() === SLACK_INTAKE_WELCOME_TEXT,
    );
    if (existingWelcome) {
      await databasePool().query(
        `UPDATE slack_intake_connections
            SET welcome_message_ts=$2,updated_at=now()
          WHERE org_id=$1`,
        [input.orgId, existingWelcome.ts],
      );
      return (await getSlackIntakeStatus(input.orgId))!;
    }
    const welcome = await postSlackMessage(context, {
      channelId: channel.id,
      text: SLACK_INTAKE_WELCOME_TEXT,
      blocks: [
        {
          type: "header",
          text: { type: "plain_text", text: "CloseSpan feedback intake is active" },
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: "Post customer feedback in this channel. CloseSpan will group related signals into Product Problems and keep each problem in one thread.",
          },
        },
        {
          type: "context",
          elements: [
            {
              type: "mrkdwn",
              text: "Human action is requested only for *Approve one run*, scope changes, and post-release verification.",
            },
          ],
        },
      ],
    });
    await databasePool().query(
      `UPDATE slack_intake_connections
          SET welcome_message_ts=$2,updated_at=now()
        WHERE org_id=$1`,
      [input.orgId, welcome.ts],
    );
  }
  return (await getSlackIntakeStatus(input.orgId))!;
}

function allowedSlackMessage(message: SlackMessage): boolean {
  return (
    !message.bot_id &&
    (!message.subtype || message.subtype === "file_share") &&
    typeof message.ts === "string"
  );
}

export async function disconnectSlackIntake(
  orgId: string,
  accountId: string,
): Promise<void> {
  if (workspacePersistenceMode(orgId) !== "postgres") return;
  await databasePool().query(
    `UPDATE slack_intake_connections SET state='Disconnected',updated_at=now()
      WHERE org_id=$1 AND account_id=$2`,
    [orgId, accountId],
  );
}

export function summarizeSlackThread(messages: SlackMessage[]): {
  text: string;
  authorId: string | null;
  reactions: Array<{ name: string; count: number }>;
  files: Array<{
    id: string;
    name: string;
    mimeType: string | null;
    size: number | null;
  }>;
} | null {
  const customerMessages = messages.filter(allowedSlackMessage);
  const reactions = new Map<string, number>();
  const files = new Map<string, ReturnType<typeof normalizedFile>>();
  const parts: string[] = [];
  for (const message of customerMessages) {
    const body = message.text?.replace(/<@([A-Z0-9]+)>/g, "@$1").trim();
    if (body) parts.push(body);
    for (const reaction of message.reactions ?? []) {
      if (!validReaction(reaction)) continue;
      reactions.set(
        reaction.name,
        (reactions.get(reaction.name) ?? 0) + reaction.count,
      );
    }
    for (const file of message.files ?? []) {
      const normalized = normalizedFile(file);
      if (normalized) files.set(normalized.id, normalized);
    }
  }
  const fileList = [...files.values()].filter(
    (file): file is NonNullable<typeof file> => Boolean(file),
  );
  if (parts.length === 0 && fileList.length === 0) return null;
  if (fileList.length > 0) {
    parts.push(
      `Attachments: ${fileList.map((file) => `${file.name}${file.mimeType ? ` (${file.mimeType})` : ""}`).join(", ")}`,
    );
  }
  return {
    text: redactUntrustedText(parts.join("\n\n")).slice(0, MAX_SIGNAL_TEXT),
    authorId: customerMessages[0]?.user ?? null,
    reactions: [...reactions.entries()].map(([name, count]) => ({ name, count })),
    files: fileList,
  };
}

function validReaction(value: SlackReaction): boolean {
  return (
    typeof value?.name === "string" &&
    value.name.length > 0 &&
    Number.isInteger(value.count) &&
    value.count > 0
  );
}

function normalizedFile(file: SlackFile): {
  id: string;
  name: string;
  mimeType: string | null;
  size: number | null;
} | null {
  if (!file || typeof file.id !== "string") return null;
  const name = String(file.name || file.title || "Slack attachment")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .trim()
    .slice(0, 255);
  return {
    id: file.id,
    name: name || "Slack attachment",
    mimeType: typeof file.mimetype === "string" ? file.mimetype.slice(0, 120) : null,
    size: Number.isFinite(file.size) ? Number(file.size) : null,
  };
}

function feedbackId(teamId: string, channelId: string, threadTs: string): string {
  return `fb_slack_${createHash("sha256")
    .update(`${teamId}:${channelId}:${threadTs}`)
    .digest("hex")
    .slice(0, 24)}`;
}

async function sentSlackMessageTimestamps(orgId: string): Promise<Set<string>> {
  const result = await databasePool().query<{ ts: string }>(
    `SELECT welcome_message_ts AS ts FROM slack_intake_connections
      WHERE org_id=$1 AND welcome_message_ts IS NOT NULL
     UNION SELECT thread_ts AS ts FROM slack_problem_threads WHERE org_id=$1
     UNION SELECT slack_message_ts AS ts FROM slack_notification_outbox
      WHERE org_id=$1 AND slack_message_ts IS NOT NULL`,
    [orgId],
  );
  return new Set(result.rows.map((row) => row.ts));
}

async function knownSlackThreadTimestamps(orgId: string): Promise<Set<string>> {
  const result = await databasePool().query<{ thread_ts: string }>(
    "SELECT thread_ts FROM slack_feedback_sources WHERE org_id=$1",
    [orgId],
  );
  return new Set(result.rows.map((row) => row.thread_ts));
}

export async function syncSlackIntake(orgId: string): Promise<{
  fetched: number;
  created: number;
  updated: number;
}> {
  const connection = await getSlackIntakeRow(orgId);
  if (
    !connection ||
    connection.state === "Disconnected" ||
    connection.state === "Needs reconnect"
  )
    return { fetched: 0, created: 0, updated: 0 };
  const context = { orgId, accountId: connection.account_id };
  try {
    const cursorNumber = timestampNumber(connection.cursor_ts);
    const roots = await listSlackChannelMessages(
      context,
      connection.channel_id,
      Math.max(0, cursorNumber - 7 * 24 * 60 * 60).toFixed(6),
    );
    const [sent, knownThreads] = await Promise.all([
      sentSlackMessageTimestamps(orgId),
      knownSlackThreadTimestamps(orgId),
    ]);
    const candidates: Array<{ root: SlackMessage; messages: SlackMessage[] }> = [];
    let threadFetches = 0;
    let maxTimestamp = timestampNumber(connection.cursor_ts);
    for (const root of [...roots].sort((a, b) => timestampNumber(a.ts) - timestampNumber(b.ts))) {
      maxTimestamp = Math.max(maxTimestamp, timestampNumber(root.ts));
      if (sent.has(root.ts)) continue;
      let messages = [root];
      if ((root.reply_count ?? 0) > 0 && threadFetches < MAX_THREAD_FETCHES_PER_TICK) {
        threadFetches += 1;
        messages = await listSlackThreadReplies(context, connection.channel_id, root.ts);
        for (const reply of messages)
          maxTimestamp = Math.max(maxTimestamp, timestampNumber(reply.ts));
      }
      if (
        !knownThreads.has(root.ts) &&
        !messages.some((message) => timestampNumber(message.ts) > cursorNumber)
      ) continue;
      const customerMessages = messages.filter((message) => !sent.has(message.ts));
      if (summarizeSlackThread(customerMessages))
        candidates.push({ root, messages: customerMessages });
    }

    let created = 0;
    let updated = 0;
    await transaction(async (client) => {
      for (const candidate of candidates) {
        const summary = summarizeSlackThread(candidate.messages);
        if (!summary) continue;
        const id = feedbackId(
          connection.team_id,
          connection.channel_id,
          candidate.root.ts,
        );
        const existing = await client.query(
          "SELECT 1 FROM feedback_items WHERE org_id=$1 AND id=$2",
          [orgId, id],
        );
        const reactionText = summary.reactions.length
          ? ` · reactions ${summary.reactions.map((item) => `:${item.name}: ×${item.count}`).join(", ")}`
          : "";
        const fileText = summary.files.length
          ? ` · ${summary.files.length} attachment${summary.files.length === 1 ? "" : "s"}`
          : "";
        const feedbackType = hasExplicitMalfunctionSignal(summary.text)
          ? "Bug"
          : "Question";
        await client.query(
          `INSERT INTO feedback_items(
             id,org_id,source,customer_name,account_tier,arr,type,severity,
             redacted,environment,confidence,observed_at,quote,integration_id,
             source_namespace,external_id
           ) VALUES($1,$2,'Slack',$3,'Unknown',0,$4,'Medium',true,$5,
                    0.60,$6,$7,'int_slack',$8,$9)
           ON CONFLICT(org_id,integration_id,source_namespace,external_id)
             WHERE external_id IS NOT NULL
           DO UPDATE SET type=excluded.type,quote=excluded.quote,environment=excluded.environment,
             observed_at=excluded.observed_at,updated_at=now()`,
          [
            id,
            orgId,
            summary.authorId ? `Slack member ${summary.authorId}` : "Slack contributor",
            feedbackType,
            `Slack #${connection.channel_name}${reactionText}${fileText}`,
            new Date(timestampNumber(candidate.root.ts) * 1_000).toISOString(),
            summary.text,
            `slack:${connection.team_id}:${connection.channel_id}`,
            candidate.root.ts,
          ],
        );
        await client.query(
          `INSERT INTO slack_feedback_sources(
             org_id,feedback_id,team_id,channel_id,message_ts,thread_ts,
             author_id,reaction_summary,file_summary
           ) VALUES($1,$2,$3,$4,$5,$5,$6,$7::jsonb,$8::jsonb)
           ON CONFLICT(org_id,feedback_id) DO UPDATE SET
             author_id=excluded.author_id,reaction_summary=excluded.reaction_summary,
             file_summary=excluded.file_summary`,
          [
            orgId,
            id,
            connection.team_id,
            connection.channel_id,
            candidate.root.ts,
            summary.authorId,
            JSON.stringify(summary.reactions),
            JSON.stringify(summary.files),
          ],
        );
        if (existing.rowCount) updated += 1;
        else created += 1;
      }
      await client.query(
        `UPDATE slack_intake_connections SET cursor_ts=$2,last_polled_at=now(),
           last_error=NULL,state='Connected',updated_at=now() WHERE org_id=$1`,
        [orgId, maxTimestamp.toFixed(6)],
      );
      if (created + updated > 0) {
        await client.query(
          `UPDATE integrations SET connection_state='Connected',last_sync_at=now(),
             error_message=NULL WHERE org_id=$1 AND id='int_slack'`,
          [orgId],
        );
      }
    });
    return { fetched: candidates.length, created, updated };
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 500) : "Slack intake failed";
    await databasePool().query(
      `UPDATE slack_intake_connections SET state='Error',last_error=$2,
         last_polled_at=now(),updated_at=now() WHERE org_id=$1`,
      [orgId, message],
    );
    throw error;
  }
}

async function pendingSlackFeedback(orgId: string): Promise<string[]> {
  const result = await databasePool().query<{ id: string }>(
    `SELECT feedback.id
       FROM feedback_items feedback
       JOIN slack_feedback_sources source
         ON source.org_id=feedback.org_id AND source.feedback_id=feedback.id
      WHERE feedback.org_id=$1
        AND NOT EXISTS (
          SELECT 1 FROM ai_feedback_analyses analysis
          JOIN model_runs run ON run.org_id=analysis.org_id
            AND run.id=analysis.model_run_id AND run.status='Succeeded'
          WHERE analysis.org_id=feedback.org_id
            AND analysis.feedback_id=feedback.id
        )
      ORDER BY feedback.created_at,feedback.id LIMIT 25`,
    [orgId],
  );
  return result.rows.map((row) => row.id);
}

export async function analyzeAndClusterSlackSignals(orgId: string): Promise<{
  analyzed: number;
  clustered: number;
}> {
  const feedbackIds = await pendingSlackFeedback(orgId);
  if (feedbackIds.length === 0) return { analyzed: 0, clustered: 0 };
  const configuration = await getAiRuntimeConfiguration(orgId);
  if (!configuration.configured || !configuration.apiKey)
    return { analyzed: 0, clustered: 0 };
  const analysisContext = await getFeedbackAnalysisContext(orgId, feedbackIds);
  const batchKey = createHash("sha256").update(feedbackIds.join(":"))
    .digest("hex").slice(0, 32);
  const retryWindow = Math.floor(Date.now() / (5 * 60_000));
  const reservation = await reserveModelRun({
    orgId,
    promptVersionId: analysisContext.prompt.id,
    provider: configuration.provider,
    providerLabel: configuration.providerLabel,
    model: configuration.model,
    idempotencyKey: `slack-intake-${batchKey}-${retryWindow}`,
    feedbackIds,
  });
  if (reservation.kind !== "created")
    return { analyzed: reservation.kind === "replay" ? feedbackIds.length : 0, clustered: 0 };
  try {
    const analysis = await analyzeFeedbackWithProvider({
      configuration,
      systemPrompt: analysisContext.prompt.systemPrompt,
      feedback: analysisContext.feedback,
      candidates: analysisContext.candidates,
    });
    const context = {
      orgId,
      organizationName: "CloseSpan workspace",
      actorId: "agent_slack_intake",
      actorName: "Slack intake agent",
      actorEmail: "automation@closespan.com",
      role: "Admin",
      idempotencyKey: `slack-analysis-${batchKey}`,
      traceId: `slack-analysis-${batchKey}`,
    };
    await completeModelRun({
      orgId,
      runId: reservation.runId,
      result: analysis,
      context,
    });
    let clustered = 0;
    for (const item of analysis.analyses) {
      if (item.classification === "Noise" || item.classification === "Question") continue;
      const confident = item.proposedProblemId
        ? item.classificationConfidence >= 0.78 && item.clusterConfidence >= 0.78
        : item.classificationConfidence >= 0.85;
      if (!confident) continue;
      const result = await reviewLatestFeedbackAnalysis({
        orgId,
        feedbackId: item.feedbackId,
        decision: "approve",
        problemId: item.proposedProblemId,
        context: {
          ...context,
          idempotencyKey: `slack-review-${createHash("sha256")
            .update(`${item.feedbackId}:${item.redactedSummary}`)
            .digest("hex").slice(0, 32)}`,
          traceId: `slack-review-${item.feedbackId}`,
        },
      });
      if (result.problem) {
        clustered += 1;
        await enqueueSlackNotification({
          orgId,
          problemId: result.problem.id,
          eventType: "problem_detected",
          idempotencyKey: `slack-problem:${result.analysisId}`,
          payload: {
            feedbackId: item.feedbackId,
            createdProblem: result.createdProblem,
          },
        });
      }
    }
    return { analyzed: analysis.analyses.length, clustered };
  } catch (error) {
    await failModelRun(orgId, reservation.runId, error);
    throw error;
  }
}

export async function enqueueSlackNotification(input: {
  orgId: string;
  problemId: string;
  eventType: SlackNotificationEvent;
  idempotencyKey: string;
  payload?: Record<string, unknown>;
}): Promise<void> {
  if (workspacePersistenceMode(input.orgId) !== "postgres") return;
  await databasePool().query(
    `INSERT INTO slack_notification_outbox(
       org_id,problem_id,event_type,idempotency_key,payload
     ) VALUES($1,$2,$3,$4,$5::jsonb)
     ON CONFLICT(org_id,idempotency_key) DO NOTHING`,
    [
      input.orgId,
      input.problemId,
      input.eventType,
      input.idempotencyKey,
      JSON.stringify(input.payload ?? {}),
    ],
  );
}

export async function reconcileSlackNotifications(orgId: string): Promise<void> {
  const statements = [
    {
      event: "approval_required",
      key: "approval:",
      join: `JOIN approval_requests item ON item.org_id=problem.org_id
             AND item.problem_id=problem.id AND item.action_type='agent_run'
             AND item.status='Pending'`,
      id: "item.id",
    },
    {
      event: "run_blocked",
      key: "run-blocked:",
      join: `JOIN agent_runs item ON item.org_id=problem.org_id
             AND item.problem_id=problem.id AND item.status='Failed'`,
      id: "item.id::text",
    },
    {
      event: "draft_pr_opened",
      key: "draft-pr:",
      join: `JOIN agent_runs item ON item.org_id=problem.org_id
             AND item.problem_id=problem.id AND item.status='Draft PR opened'`,
      id: "item.id::text",
    },
  ] as const;
  for (const statement of statements) {
    await databasePool().query(
      `INSERT INTO slack_notification_outbox(
         org_id,problem_id,event_type,idempotency_key,payload
       )
       SELECT DISTINCT problem.org_id,problem.id,$2,$3 || ${statement.id},'{}'::jsonb
         FROM product_problems problem
         ${statement.join}
        WHERE problem.org_id=$1
          AND EXISTS (
            SELECT 1 FROM feedback_cluster_memberships membership
            JOIN slack_feedback_sources source ON source.org_id=membership.org_id
              AND source.feedback_id=membership.feedback_id
            WHERE membership.org_id=problem.org_id
              AND membership.problem_id=problem.id
          )
       ON CONFLICT(org_id,idempotency_key) DO NOTHING`,
      [orgId, statement.event, statement.key],
    );
  }
  for (const stage of ["Released", "Verified"] as const) {
    const events: SlackNotificationEvent[] = stage === "Released"
      ? ["released", "verification_required"]
      : ["verified"];
    for (const event of events) {
      await databasePool().query(
        `INSERT INTO slack_notification_outbox(
           org_id,problem_id,event_type,idempotency_key,payload
         )
         SELECT DISTINCT problem.org_id,problem.id,$2,
                $2 || ':' || problem.id || ':' || problem.updated_at::text,
                '{}'::jsonb
           FROM product_problems problem
          WHERE problem.org_id=$1 AND problem.stage=$3
            AND EXISTS (
              SELECT 1 FROM feedback_cluster_memberships membership
              JOIN slack_feedback_sources source ON source.org_id=membership.org_id
                AND source.feedback_id=membership.feedback_id
              WHERE membership.org_id=problem.org_id
                AND membership.problem_id=problem.id
            )
         ON CONFLICT(org_id,idempotency_key) DO NOTHING`,
        [orgId, event, stage],
      );
    }
  }
}

function notificationCopy(
  event: SlackNotificationEvent,
  problem: { id: string; title: string; severity: string; stage: string },
  payload: Record<string, unknown>,
): { text: string; actionLabel?: string; actionPath?: string } {
  const ticket = `${problem.id} · ${problem.title}`;
  if (event === "problem_detected") {
    return payload.createdProblem === false
      ? { text: `A related Slack signal was added to *${ticket}*.` }
      : { text: `*${ticket}*\nCloseSpan detected and grouped a new Product Problem. Severity: ${problem.severity}.` };
  }
  if (event === "approval_required")
    return { text: `*Approval required · ${ticket}*\nThe implementation prompt is ready. One approval authorizes one coding-agent run.`, actionLabel: "Approve one run", actionPath: "/approvals" };
  if (event === "run_blocked")
    return { text: `*Run blocked · ${ticket}*\nThe coding run stopped and needs review. No merge or deployment occurred.`, actionLabel: "Review run", actionPath: `/problems/${problem.id}` };
  if (event === "draft_pr_opened")
    return { text: `*Draft PR opened · ${ticket}*\nImplementation evidence and tests are ready for engineering review.`, actionLabel: "Review ticket", actionPath: `/problems/${problem.id}` };
  if (event === "released")
    return { text: `*Released · ${ticket}*\nThe implementation reached its intended environment.` };
  if (event === "verification_required")
    return { text: `*Verification required · ${ticket}*\nConfirm that the original customer problem is resolved before CloseSpan marks it Verified.`, actionLabel: "Verify release", actionPath: `/problems/${problem.id}` };
  return { text: `*Verified · ${ticket}*\nRelease evidence confirms the customer problem is resolved.` };
}

function applicationUrl(path: string): string {
  const base = (
    process.env.AUTH_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    "http://localhost:3000"
  ).replace(/\/$/, "");
  return new URL(path, base).toString();
}

export async function deliverSlackNotifications(
  orgId: string,
  limit = 20,
): Promise<{ sent: number; failed: number }> {
  const connection = await getSlackIntakeRow(orgId);
  if (!connection || connection.state !== "Connected") return { sent: 0, failed: 0 };
  const result = await databasePool().query<{
    id: string;
    problem_id: string;
    event_type: SlackNotificationEvent;
    payload: Record<string, unknown>;
    title: string;
    severity: string;
    stage: string;
    thread_ts: string | null;
  }>(
    `SELECT outbox.id,outbox.problem_id,outbox.event_type,outbox.payload,
            problem.title,problem.severity,problem.stage,thread.thread_ts
       FROM slack_notification_outbox outbox
       JOIN product_problems problem ON problem.org_id=outbox.org_id
         AND problem.id=outbox.problem_id
       LEFT JOIN slack_problem_threads thread ON thread.org_id=outbox.org_id
         AND thread.problem_id=outbox.problem_id
      WHERE outbox.org_id=$1 AND outbox.status IN ('Pending','Failed')
        AND outbox.available_at<=now() AND outbox.attempts<5
      ORDER BY outbox.created_at LIMIT $2`,
    [orgId, limit],
  );
  let sent = 0;
  let failed = 0;
  const context = { orgId, accountId: connection.account_id };
  for (const row of result.rows) {
    const claimed = await databasePool().query(
      `UPDATE slack_notification_outbox SET status='Sending',attempts=attempts+1,
         updated_at=now() WHERE org_id=$1 AND id=$2
         AND status IN ('Pending','Failed') RETURNING id`,
      [orgId, row.id],
    );
    if (!claimed.rowCount) continue;
    try {
      const copy = notificationCopy(row.event_type, {
        id: row.problem_id,
        title: row.title,
        severity: row.severity,
        stage: row.stage,
      }, row.payload ?? {});
      const blocks: unknown[] = [
        { type: "section", text: { type: "mrkdwn", text: copy.text } },
      ];
      if (copy.actionLabel && copy.actionPath) {
        blocks.push({
          type: "actions",
          elements: [
            {
              type: "button",
              text: { type: "plain_text", text: copy.actionLabel },
              url: applicationUrl(copy.actionPath),
              action_id: `closespan_${row.event_type}`,
            },
          ],
        });
      }
      const posted = await postSlackMessage(context, {
        channelId: connection.channel_id,
        text: copy.text.replaceAll("*", ""),
        blocks,
        threadTs: row.thread_ts ?? undefined,
      });
      await transaction(async (client) => {
        if (!row.thread_ts) {
          await client.query(
            `INSERT INTO slack_problem_threads(
               org_id,problem_id,channel_id,thread_ts
             ) VALUES($1,$2,$3,$4)
             ON CONFLICT(org_id,problem_id) DO NOTHING`,
            [orgId, row.problem_id, connection.channel_id, posted.ts],
          );
        }
        await client.query(
          `UPDATE slack_notification_outbox SET status='Sent',sent_at=now(),
             slack_message_ts=$3,last_error=NULL,updated_at=now()
           WHERE org_id=$1 AND id=$2`,
          [orgId, row.id, posted.ts],
        );
      });
      sent += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 500) : "Slack notification failed";
      await databasePool().query(
        `UPDATE slack_notification_outbox SET status='Failed',last_error=$3,
           available_at=now() + make_interval(secs => LEAST(300, power(2,attempts)::int * 5)),
           updated_at=now() WHERE org_id=$1 AND id=$2`,
        [orgId, row.id, message],
      );
      failed += 1;
    }
  }
  return { sent, failed };
}

export async function runSlackAutomationForOrganization(orgId: string) {
  const intake = await getSlackIntakeStatus(orgId);
  if (!intake || intake.state === "Disconnected") return null;
  const sync = await syncSlackIntake(orgId);
  const intelligence = await analyzeAndClusterSlackSignals(orgId);
  await reconcileSlackNotifications(orgId);
  const notifications = await deliverSlackNotifications(orgId);
  return { sync, intelligence, notifications };
}

export async function runSlackAutomationForAllOrganizations() {
  const connections = await databasePool().query<{
    org_id: string;
    account_id: string;
    connected_by: string;
  }>(
    `SELECT DISTINCT ON (connection.org_id)
            connection.org_id,connection.account_id,connection.connected_by
       FROM pipedream_connections connection
      WHERE connection.integration_id='int_slack'
        AND connection.state='Connected'
      ORDER BY connection.org_id,connection.updated_at DESC,connection.id DESC`,
  );
  const outcomes = [];
  for (const row of connections.rows) {
    try {
      await ensureSlackIntakeChannel({
        orgId: row.org_id,
        accountId: row.account_id,
        actorId: row.connected_by,
        actorName: "Slack connection automation",
        traceId: `slack-provision:${row.org_id}:${row.account_id}`,
      });
      outcomes.push({
        orgId: row.org_id,
        result: await runSlackAutomationForOrganization(row.org_id),
      });
    } catch (error) {
      outcomes.push({
        orgId: row.org_id,
        error: error instanceof Error ? error.message : "Slack automation failed",
      });
    }
  }
  return outcomes;
}
