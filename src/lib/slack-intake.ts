import { createHash, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
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
  "CloseSpan is listening in #closespan-feedback. Nearby messages and thread replies are grouped into conversations. Clear product feedback is recorded automatically; ambiguous conversations are held for confirmation, and casual chat is ignored.";
const MAX_THREAD_FETCHES_PER_TICK = 25;
const MAX_SIGNAL_TEXT = 8_000;
const IN_BATCH_CLUSTER_THRESHOLD = 0.9;
const SLACK_CONVERSATION_GRACE_MS = 2 * 60_000;
const SLACK_CONVERSATION_WINDOW_MS = 5 * 60_000;

export type SlackConversationState =
  | "Pending"
  | "Review"
  | "Confirmed"
  | "Ignored"
  | "Deleted";

export interface SlackConversationDecision {
  state: Exclude<SlackConversationState, "Pending" | "Deleted">;
  classification:
    | "Bug"
    | "Feature request"
    | "Usability"
    | "Question"
    | "Incident"
    | "Noise";
  confidence: number;
  reason: string;
}

interface SlackMessageSnapshot {
  ts: string;
  activityTs?: string;
  user?: string;
  text?: string;
  reactions?: SlackReaction[];
  files?: SlackFile[];
}

interface SlackIntakeCandidateRow {
  id: string;
  anchor_ts: string;
  author_id: string | null;
  state: SlackConversationState;
  classification: SlackConversationDecision["classification"] | null;
  confidence: number;
  decision_reason: string;
  summary_text: string;
  message_snapshots: unknown;
  quiet_until: Date;
  last_message_at: Date;
  confirmation_message_ts: string | null;
  promoted_feedback_id: string | null;
}

const SLACK_CONFIRM_FEEDBACK = /^(?:record|save|track|capture)(?: this)?(?: as)? feedback[.!]?$/i;
const SLACK_IGNORE_FEEDBACK = /^(?:ignore|dismiss|cancel|do not record|don['’]?t record)(?: this)?[.!]?$/i;
const SLACK_TRIVIAL_MESSAGE = /^(?:hi|hello|hey|thanks|thank you|thx|ok(?:ay)?|cool|great|nice|checking|check|test(?:ing)?|ping|got it|sounds good|yes|no|yep|nope|lol|👍|👋|🙏)[!.\s]*$/i;
const SLACK_LINK_ONLY = /^(?:https?:\/\/\S+|<https?:\/\/[^>]+>)(?:\s+(?:https?:\/\/\S+|<https?:\/\/[^>]+>))*$/i;
const SLACK_FEATURE_SIGNAL = /\b(?:please add|add support|feature request|would like|we need|needs? (?:an?|the)|should (?:have|support|allow)|could (?:we|you)|can (?:we|you) add|wish (?:it|we|there)|missing (?:an?|the)|new (?:feature|option|setting)|enable (?:us|users)|let (?:us|users))\b/i;
const SLACK_USABILITY_SIGNAL = /\b(?:confus(?:ing|ed)|hard to (?:use|find|understand)|difficult to (?:use|find|understand)|can['’]?t find|cannot find|unclear|not obvious|too many clicks|usability|ux)\b/i;
const SLACK_INCIDENT_SIGNAL = /\b(?:outage|downtime|service unavailable|system unavailable|production is down|all users? (?:are )?blocked)\b/i;
const SLACK_PRODUCT_CONTEXT = /\b(?:app|product|page|screen|view|button|menu|form|field|caption|export|import|upload|download|login|sign[ -]?in|account|workspace|project|repository|repo|pull request|pr|notification|dashboard|report|search|filter|editor|generate|regenerate|undo|save|delete|sync|api|integration|slack|github|ios|android|web|mobile|desktop|workflow|setting|feature|error|crash)\b/i;
const SLACK_BEHAVIOR_CONTEXT = /\b(?:when|after|before|because|instead|expected|currently|always|never|sometimes|steps?|reproduc|while|then)\b/i;

function boundedConfidence(value: number): number {
  return Math.max(0, Math.min(1, Math.round(value * 100) / 100));
}

export function slackConversationControl(
  messages: Pick<SlackMessage, "text">[],
): "confirm" | "ignore" | null {
  for (const message of [...messages].reverse()) {
    const text = message.text?.trim();
    if (!text) continue;
    if (SLACK_CONFIRM_FEEDBACK.test(text)) return "confirm";
    if (SLACK_IGNORE_FEEDBACK.test(text)) return "ignore";
  }
  return null;
}

export function classifySlackConversation(input: {
  text: string;
  reactions?: Array<{ name: string; count: number }>;
  files?: Array<{ id: string }>;
  control?: "confirm" | "ignore" | null;
}): SlackConversationDecision {
  const text = input.text.replace(/\s+/g, " ").trim();
  const words = text.match(/[\p{L}\p{N}][\p{L}\p{N}'’_-]*/gu) ?? [];
  const hasFiles = (input.files?.length ?? 0) > 0;
  const hasReactions = (input.reactions ?? []).some((reaction) => reaction.count > 0);

  if (input.control === "ignore") {
    return { state: "Ignored", classification: "Noise", confidence: 1, reason: "A person explicitly dismissed the candidate." };
  }
  if (
    !text || SLACK_TRIVIAL_MESSAGE.test(text) || SLACK_LINK_ONLY.test(text) ||
    /^\/[a-z0-9_-]+(?:\s.*)?$/i.test(text) ||
    (words.length < 3 && !hasFiles)
  ) {
    return { state: "Ignored", classification: "Noise", confidence: 0.98, reason: "The conversation contains no actionable product feedback." };
  }

  const incident = SLACK_INCIDENT_SIGNAL.test(text);
  const bug = hasExplicitMalfunctionSignal(text) || /\b(?:crash(?:es|ed|ing)?|error|incorrect|wrong result|data loss|times? out)\b/i.test(text);
  const feature = SLACK_FEATURE_SIGNAL.test(text);
  const usability = SLACK_USABILITY_SIGNAL.test(text);
  const productContext = SLACK_PRODUCT_CONTEXT.test(text);
  const behavioralDetail = SLACK_BEHAVIOR_CONTEXT.test(text);
  const actionable = incident || bug || feature || usability;
  const classification = incident
    ? "Incident"
    : bug
      ? "Bug"
      : feature
        ? "Feature request"
        : usability
          ? "Usability"
          : "Question";

  let confidence = actionable ? 0.5 : 0.18;
  if (incident) confidence += 0.15;
  if (words.length >= 8) confidence += 0.15;
  else if (words.length >= 5) confidence += 0.08;
  if (productContext) confidence += 0.15;
  if (behavioralDetail) confidence += 0.08;
  if (hasFiles) confidence += 0.08;
  if (hasReactions) confidence += 0.04;
  confidence = boundedConfidence(confidence);

  if (input.control === "confirm" && (productContext || actionable || hasFiles)) {
    return {
      state: "Confirmed",
      classification: classification === "Question" ? "Feature request" : classification,
      confidence: Math.max(0.9, confidence),
      reason: "A person explicitly confirmed this conversation as feedback.",
    };
  }
  if (actionable && confidence >= 0.75) {
    return { state: "Confirmed", classification, confidence, reason: "The conversation contains a clear product behavior and actionable intent." };
  }
  if ((actionable || productContext || hasFiles) && confidence >= 0.4) {
    return { state: "Review", classification, confidence, reason: "This may be product feedback, but the intent is ambiguous and needs confirmation." };
  }
  return { state: "Ignored", classification: "Noise", confidence, reason: "The conversation does not contain enough product context to create a signal." };
}

interface InBatchProblem {
  problemId: string;
  classification: string;
  summary: string;
}

function normalizedClusterWords(value: string): string[] {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function wordBigrams(value: string): Set<string> {
  const words = normalizedClusterWords(value);
  if (words.length < 2) return new Set(words);
  return new Set(words.slice(0, -1).map((word, index) => `${word} ${words[index + 1]}`));
}

export function batchProblemSimilarity(left: string, right: string): number {
  const leftNormalized = normalizedClusterWords(left).join(" ");
  const rightNormalized = normalizedClusterWords(right).join(" ");
  if (!leftNormalized || !rightNormalized) return 0;
  if (leftNormalized === rightNormalized) return 1;
  const leftBigrams = wordBigrams(leftNormalized);
  const rightBigrams = wordBigrams(rightNormalized);
  let overlap = 0;
  for (const bigram of leftBigrams) {
    if (rightBigrams.has(bigram)) overlap += 1;
  }
  return (2 * overlap) / (leftBigrams.size + rightBigrams.size);
}

function findInBatchProblem(
  candidates: InBatchProblem[],
  classification: string,
  summary: string,
): InBatchProblem | null {
  let best: { candidate: InBatchProblem; similarity: number } | null = null;
  for (const candidate of candidates) {
    if (candidate.classification !== classification) continue;
    const similarity = batchProblemSimilarity(candidate.summary, summary);
    if (!best || similarity > best.similarity) best = { candidate, similarity };
  }
  return best && best.similarity >= IN_BATCH_CLUSTER_THRESHOLD
    ? best.candidate
    : null;
}

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

function timestampDate(value: string): Date {
  return new Date(timestampNumber(value) * 1_000);
}

function messageActivityTimestamp(message: SlackMessage): string {
  return message.edited?.ts ?? message.ts;
}

function candidateId(teamId: string, channelId: string, anchorTs: string): string {
  return `slack_candidate_${createHash("sha256")
    .update(`${teamId}:${channelId}:${anchorTs}`)
    .digest("hex")
    .slice(0, 24)}`;
}

function messageSnapshots(messages: SlackMessage[]): SlackMessageSnapshot[] {
  return messages.filter(allowedSlackMessage).map((message) => ({
    ts: message.ts,
    ...(message.edited?.ts ? { activityTs: message.edited.ts } : {}),
    ...(message.user ? { user: message.user } : {}),
    ...(message.text ? { text: message.text } : {}),
    ...(message.reactions ? { reactions: message.reactions } : {}),
    ...(message.files ? { files: message.files } : {}),
  }));
}

function parseMessageSnapshots(value: unknown): SlackMessageSnapshot[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is SlackMessageSnapshot =>
    Boolean(item && typeof item === "object" && typeof (item as { ts?: unknown }).ts === "string"),
  );
}

function snapshotsAsMessages(value: unknown): SlackMessage[] {
  return parseMessageSnapshots(value).map((snapshot) => ({
    type: "message",
    ts: snapshot.ts,
    user: snapshot.user,
    text: snapshot.text,
    reactions: snapshot.reactions,
    files: snapshot.files,
  }));
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
  const channelBindingChanged =
    previous?.account_id !== input.accountId ||
    previous?.channel_id !== channel.id;
  if (!existing || channelBindingChanged) {
    await setSlackChannelPurpose(context, channel.id);
  }

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
            text: "Post customer feedback or discuss it naturally. CloseSpan groups nearby messages, records clear product signals, asks before recording ambiguous conversations, and ignores casual chat.",
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
    if (body && !SLACK_CONFIRM_FEEDBACK.test(body) && !SLACK_IGNORE_FEEDBACK.test(body))
      parts.push(body);
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
      WHERE org_id=$1 AND slack_message_ts IS NOT NULL
     UNION SELECT confirmation_message_ts AS ts FROM slack_intake_candidates
      WHERE org_id=$1 AND confirmation_message_ts IS NOT NULL`,
    [orgId],
  );
  return new Set(result.rows.map((row) => row.ts));
}

async function findSlackCandidate(
  client: PoolClient,
  input: {
    orgId: string;
    channelId: string;
    anchorTs: string;
    authorId: string | null;
    messageTs: string[];
    oldestSessionDate: Date;
  },
): Promise<SlackIntakeCandidateRow | null> {
  const result = await client.query<SlackIntakeCandidateRow>(
    `SELECT id,anchor_ts,author_id,state,classification,confidence,decision_reason,
            summary_text,message_snapshots,quiet_until,last_message_at,
            confirmation_message_ts,promoted_feedback_id
       FROM slack_intake_candidates candidate
      WHERE candidate.org_id=$1 AND candidate.channel_id=$2
        AND (
          candidate.anchor_ts=$3
          OR EXISTS (
            SELECT 1 FROM jsonb_array_elements(candidate.message_snapshots) snapshot
             WHERE snapshot->>'ts'=ANY($4::text[])
          )
          OR (
            $5::text IS NOT NULL AND candidate.author_id=$5
            AND candidate.state IN ('Pending','Review','Confirmed')
            AND candidate.promoted_feedback_id IS NULL
            AND candidate.last_message_at >= $6
          )
        )
      ORDER BY CASE WHEN candidate.anchor_ts=$3 THEN 0 ELSE 1 END,
               candidate.last_message_at DESC
      LIMIT 1`,
    [
      input.orgId,
      input.channelId,
      input.anchorTs,
      input.messageTs,
      input.authorId,
      input.oldestSessionDate,
    ],
  );
  return result.rows[0] ?? null;
}

function mergeSlackSnapshots(
  previous: unknown,
  current: SlackMessageSnapshot[],
): SlackMessageSnapshot[] {
  const merged = new Map<string, SlackMessageSnapshot>();
  for (const snapshot of [...parseMessageSnapshots(previous), ...current])
    merged.set(snapshot.ts, snapshot);
  return [...merged.values()].sort((left, right) =>
    timestampNumber(left.ts) - timestampNumber(right.ts));
}

async function stageSlackConversation(
  client: PoolClient,
  input: {
    orgId: string;
    teamId: string;
    channelId: string;
    anchorTs: string;
    messages: SlackMessage[];
  },
): Promise<boolean> {
  const incoming = messageSnapshots(input.messages);
  if (incoming.length === 0) return false;
  const authorId = incoming.find((message) => message.user)?.user ?? null;
  const lastTs = incoming.reduce(
    (latest, message) => {
      const activityTs = message.activityTs ?? message.ts;
      return timestampNumber(activityTs) > timestampNumber(latest) ? activityTs : latest;
    },
    incoming[0].activityTs ?? incoming[0].ts,
  );
  const existing = await findSlackCandidate(client, {
    orgId: input.orgId,
    channelId: input.channelId,
    anchorTs: input.anchorTs,
    authorId,
    messageTs: incoming.map((message) => message.ts),
    oldestSessionDate: new Date(timestampDate(lastTs).getTime() - SLACK_CONVERSATION_WINDOW_MS),
  });
  const snapshots = mergeSlackSnapshots(existing?.message_snapshots, incoming);
  const messages = snapshotsAsMessages(snapshots);
  const summary = summarizeSlackThread(messages);
  if (!summary) return false;
  const control = slackConversationControl(messages);
  const decision = classifySlackConversation({
    text: summary.text,
    reactions: summary.reactions,
    files: summary.files,
    control,
  });
  const anchorTs = existing?.anchor_ts ?? input.anchorTs;
  const id = existing?.id ?? candidateId(input.teamId, input.channelId, anchorTs);
  const lastMessageAt = timestampDate(lastTs);
  const quietUntil = new Date(lastMessageAt.getTime() + SLACK_CONVERSATION_GRACE_MS);
  await client.query(
    `INSERT INTO slack_intake_candidates(
       id,org_id,team_id,channel_id,anchor_ts,author_id,state,classification,
       confidence,decision_reason,summary_text,message_snapshots,quiet_until,
       last_message_at
     ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14)
     ON CONFLICT(org_id,id) DO UPDATE SET
       author_id=COALESCE(slack_intake_candidates.author_id,excluded.author_id),
       state=excluded.state,classification=excluded.classification,
       confidence=excluded.confidence,decision_reason=excluded.decision_reason,
       summary_text=excluded.summary_text,message_snapshots=excluded.message_snapshots,
       quiet_until=excluded.quiet_until,last_message_at=excluded.last_message_at,
       updated_at=now()`,
    [
      id,
      input.orgId,
      input.teamId,
      input.channelId,
      anchorTs,
      authorId,
      decision.state,
      decision.classification,
      decision.confidence,
      decision.reason,
      summary.text,
      JSON.stringify(snapshots),
      quietUntil,
      lastMessageAt,
    ],
  );
  return true;
}

async function deletePromotedSlackCandidate(
  client: PoolClient,
  orgId: string,
  candidate: SlackIntakeCandidateRow,
): Promise<void> {
  if (!candidate.promoted_feedback_id) return;
  await client.query(
    `DELETE FROM feedback_cluster_memberships WHERE org_id=$1 AND feedback_id=$2`,
    [orgId, candidate.promoted_feedback_id],
  );
  await client.query(
    `DELETE FROM feedback_items WHERE org_id=$1 AND id=$2`,
    [orgId, candidate.promoted_feedback_id],
  );
  await client.query(
    `DELETE FROM product_problems problem
      WHERE problem.org_id=$1 AND problem.stage IN ('Detected','Needs review')
        AND NOT EXISTS (
          SELECT 1 FROM feedback_cluster_memberships membership
           WHERE membership.org_id=problem.org_id AND membership.problem_id=problem.id
        )`,
    [orgId],
  );
}

async function promoteSlackCandidate(
  client: PoolClient,
  orgId: string,
  connection: SlackIntakeRow,
  candidate: SlackIntakeCandidateRow,
): Promise<"created" | "updated"> {
  const id = feedbackId(connection.team_id, connection.channel_id, candidate.anchor_ts);
  const existing = await client.query(
    "SELECT 1 FROM feedback_items WHERE org_id=$1 AND id=$2",
    [orgId, id],
  );
  const messages = snapshotsAsMessages(candidate.message_snapshots);
  const summary = summarizeSlackThread(messages);
  if (!summary) throw new Error("Confirmed Slack feedback has no recordable content.");
  const reactionText = summary.reactions.length
    ? ` · reactions ${summary.reactions.map((item) => `:${item.name}: ×${item.count}`).join(", ")}`
    : "";
  const fileText = summary.files.length
    ? ` · ${summary.files.length} attachment${summary.files.length === 1 ? "" : "s"}`
    : "";
  const feedbackType = candidate.classification === "Noise"
    ? "Question"
    : candidate.classification ?? "Question";
  await client.query(
    `INSERT INTO feedback_items(
       id,org_id,source,customer_name,account_tier,arr,type,severity,
       redacted,environment,confidence,observed_at,quote,integration_id,
       source_namespace,external_id
     ) VALUES($1,$2,'Slack',$3,'Unknown',0,$4,'Medium',true,$5,
              $6,$7,$8,'int_slack',$9,$10)
     ON CONFLICT(org_id,integration_id,source_namespace,external_id)
       WHERE external_id IS NOT NULL
     DO UPDATE SET type=excluded.type,quote=excluded.quote,environment=excluded.environment,
       confidence=excluded.confidence,observed_at=excluded.observed_at,updated_at=now()`,
    [
      id,
      orgId,
      summary.authorId ? `Slack member ${summary.authorId}` : "Slack contributor",
      feedbackType,
      `Slack #${connection.channel_name}${reactionText}${fileText}`,
      candidate.confidence,
      timestampDate(candidate.anchor_ts).toISOString(),
      summary.text,
      `slack:${connection.team_id}:${connection.channel_id}`,
      candidate.anchor_ts,
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
      candidate.anchor_ts,
      summary.authorId,
      JSON.stringify(summary.reactions),
      JSON.stringify(summary.files),
    ],
  );
  await client.query(
    `UPDATE slack_intake_candidates
        SET promoted_feedback_id=$3,quiet_until='infinity',updated_at=now()
      WHERE org_id=$1 AND id=$2`,
    [orgId, candidate.id, id],
  );
  return existing.rowCount ? "updated" : "created";
}

async function matureSlackCandidates(
  orgId: string,
  context: SlackProxyContext,
  connection: SlackIntakeRow,
): Promise<{ created: number; updated: number }> {
  const result = await databasePool().query<SlackIntakeCandidateRow>(
    `SELECT id,anchor_ts,author_id,state,classification,confidence,decision_reason,
            summary_text,message_snapshots,quiet_until,last_message_at,
            confirmation_message_ts,promoted_feedback_id
       FROM slack_intake_candidates
      WHERE org_id=$1 AND quiet_until<=now()
        AND state IN ('Review','Confirmed','Ignored','Deleted')
      ORDER BY quiet_until,id LIMIT 50`,
    [orgId],
  );
  let created = 0;
  let updated = 0;
  for (const candidate of result.rows) {
    if (candidate.state === "Review") {
      if (!candidate.confirmation_message_ts) {
        const posted = await postSlackMessage(context, {
          channelId: connection.channel_id,
          threadTs: candidate.anchor_ts,
          text: "CloseSpan found possible product feedback but will not record it without confirmation. Reply `record feedback` to confirm or `ignore` to dismiss.",
        });
        await databasePool().query(
          `UPDATE slack_intake_candidates
              SET confirmation_message_ts=$3,quiet_until='infinity',updated_at=now()
            WHERE org_id=$1 AND id=$2`,
          [orgId, candidate.id, posted.ts],
        );
      } else {
        await databasePool().query(
          `UPDATE slack_intake_candidates
              SET quiet_until='infinity',updated_at=now()
            WHERE org_id=$1 AND id=$2`,
          [orgId, candidate.id],
        );
      }
      continue;
    }
    await transaction(async (client) => {
      if (candidate.state === "Deleted" || candidate.state === "Ignored") {
        await deletePromotedSlackCandidate(client, orgId, candidate);
        await client.query(
          `UPDATE slack_intake_candidates SET quiet_until='infinity',updated_at=now()
            WHERE org_id=$1 AND id=$2`,
          [orgId, candidate.id],
        );
        return;
      }
      const outcome = await promoteSlackCandidate(client, orgId, connection, candidate);
      if (outcome === "created") created += 1;
      else updated += 1;
    });
  }
  return { created, updated };
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
    const sent = await sentSlackMessageTimestamps(orgId);
    const candidates: Array<{ root: SlackMessage; messages: SlackMessage[] }> = [];
    const deletedMessageTimestamps: string[] = [];
    let threadFetches = 0;
    let maxTimestamp = timestampNumber(connection.cursor_ts);
    for (const root of [...roots].sort((a, b) => timestampNumber(a.ts) - timestampNumber(b.ts))) {
      maxTimestamp = Math.max(maxTimestamp, timestampNumber(messageActivityTimestamp(root)));
      if (root.subtype === "message_deleted" && root.deleted_ts) {
        deletedMessageTimestamps.push(root.deleted_ts);
        continue;
      }
      if (sent.has(root.ts)) continue;
      let messages = [root];
      if ((root.reply_count ?? 0) > 0 && threadFetches < MAX_THREAD_FETCHES_PER_TICK) {
        threadFetches += 1;
        messages = await listSlackThreadReplies(context, connection.channel_id, root.ts);
        for (const reply of messages)
          maxTimestamp = Math.max(maxTimestamp, timestampNumber(messageActivityTimestamp(reply)));
      }
      const customerMessages = messages.filter((message) => !sent.has(message.ts));
      if (!customerMessages.some((message) =>
        timestampNumber(messageActivityTimestamp(message)) > cursorNumber))
        continue;
      if (summarizeSlackThread(customerMessages))
        candidates.push({ root, messages: customerMessages });
    }

    await transaction(async (client) => {
      for (const deletedTs of deletedMessageTimestamps) {
        await client.query(
          `UPDATE slack_intake_candidates candidate
              SET state='Deleted',quiet_until=now(),updated_at=now()
            WHERE candidate.org_id=$1 AND candidate.channel_id=$2
              AND (
                candidate.anchor_ts=$3 OR EXISTS (
                  SELECT 1 FROM jsonb_array_elements(candidate.message_snapshots) snapshot
                   WHERE snapshot->>'ts'=$3
                )
              )`,
          [orgId, connection.channel_id, deletedTs],
        );
      }
      for (const candidate of candidates) {
        await stageSlackConversation(client, {
          orgId,
          teamId: connection.team_id,
          channelId: connection.channel_id,
          anchorTs: candidate.root.ts,
          messages: candidate.messages,
        });
      }
      await client.query(
        `UPDATE slack_intake_connections SET cursor_ts=$2,last_polled_at=now(),
           last_error=NULL,state='Connected',updated_at=now() WHERE org_id=$1`,
        [orgId, maxTimestamp.toFixed(6)],
      );
      await client.query(
        `UPDATE integrations SET connection_state='Connected',last_sync_at=now(),
           error_message=NULL WHERE org_id=$1 AND id='int_slack'`,
        [orgId],
      );
    });
    const matured = await matureSlackCandidates(orgId, context, connection);
    return {
      fetched: candidates.length,
      created: matured.created,
      updated: matured.updated,
    };
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
    const inBatchProblems: InBatchProblem[] = [];
    for (const item of analysis.analyses) {
      if (item.classification === "Noise" || item.classification === "Question") continue;
      // Every analysis in this provider call sees the same candidate snapshot.
      // Reuse a highly similar problem created earlier in this batch so two
      // repeated messages cannot each create their own problem.
      const inBatchMatch = item.proposedProblemId
        ? null
        : findInBatchProblem(inBatchProblems, item.classification, item.redactedSummary);
      const targetProblemId = item.proposedProblemId ?? inBatchMatch?.problemId ?? null;
      const confident = item.proposedProblemId
        ? item.classificationConfidence >= 0.78 && item.clusterConfidence >= 0.78
        : item.classificationConfidence >= 0.85;
      if (!confident) continue;
      const result = await reviewLatestFeedbackAnalysis({
        orgId,
        feedbackId: item.feedbackId,
        decision: "approve",
        problemId: targetProblemId,
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
        if (!inBatchProblems.some((candidate) => candidate.problemId === result.problem!.id)) {
          inBatchProblems.push({
            problemId: result.problem.id,
            classification: item.classification,
            summary: item.redactedSummary,
          });
        }
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
