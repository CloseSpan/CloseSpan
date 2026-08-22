import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { databasePool, transaction } from "./db";
import { classifySlackConversation, analyzeAndClusterSlackSignals } from "./slack-intake";
import { getDiscordInstallationByGuild } from "./discord-app-repository";
import { postDiscordMessage } from "./discord-api";
import { redactUntrustedText } from "./redaction";
import { HttpError } from "./request-security";

export interface DiscordMessageEvent {
  id: string;
  guild_id?: string;
  channel_id: string;
  content?: string;
  author?: { id?: string; username?: string; global_name?: string | null; bot?: boolean };
  mentions?: Array<{ id?: string }>;
  webhook_id?: string;
}

export interface DiscordIntakeResult {
  candidateId: string | null;
  state: "Review" | "Confirmed" | "Ignored";
  classification: string;
  reason: string;
  recorded: boolean;
}

interface DiscordCandidateRow {
  id: string;
  org_id: string;
  guild_id: string;
  channel_id: string;
  message_id: string;
  author_id: string | null;
  author_name: string | null;
  submitted_by_id: string | null;
  content: string;
  classification: string;
  confidence: number;
  decision_reason: string;
  state: "Review" | "Confirmed" | "Ignored";
  promoted_feedback_id: string | null;
  confirmation_sent_at: Date | null;
}

function candidateId(guildId: string, channelId: string, messageId: string): string {
  return `dc_${createHash("sha256")
    .update(`${guildId}:${channelId}:${messageId}`)
    .digest("hex")
    .slice(0, 24)}`;
}

function feedbackId(guildId: string, channelId: string, messageId: string): string {
  return `fb_discord_${createHash("sha256")
    .update(`${guildId}:${channelId}:${messageId}`)
    .digest("hex")
    .slice(0, 24)}`;
}

function discordObservedAt(messageId: string): string {
  try {
    const epoch = Number((BigInt(messageId) >> 22n) + 1_420_070_400_000n);
    if (Number.isFinite(epoch)) return new Date(epoch).toISOString();
  } catch {
    // Non-snowflake identifiers are accepted by tests and imported histories.
  }
  return new Date().toISOString();
}

function stripDiscordMention(content: string, botUserId: string): string {
  return content.replace(new RegExp(`<@!?${botUserId}>`, "g"), " ").replace(/\s+/g, " ").trim();
}

function confirmationComponents(candidate: DiscordCandidateRow | { id: string }) {
  return [
    {
      type: 1,
      components: [
        { type: 2, style: 3, label: "Record feedback", custom_id: `closespan:confirm:${candidate.id}` },
        { type: 2, style: 2, label: "Ignore", custom_id: `closespan:ignore:${candidate.id}` },
      ],
    },
  ];
}

async function promoteDiscordCandidate(
  client: PoolClient,
  candidate: DiscordCandidateRow,
): Promise<string> {
  const id = feedbackId(candidate.guild_id, candidate.channel_id, candidate.message_id);
  const type = candidate.classification === "Noise" ? "Question" : candidate.classification;
  await client.query(
    `INSERT INTO feedback_items(
       id,org_id,source,customer_name,account_tier,arr,type,severity,
       redacted,environment,confidence,observed_at,quote,integration_id,
       source_namespace,external_id
     ) VALUES($1,$2,'Discord',$3,'Unknown',0,$4,'Medium',true,$5,$6,$7,$8,
              'int_discord',$9,$10)
     ON CONFLICT(org_id,integration_id,source_namespace,external_id)
       WHERE external_id IS NOT NULL
     DO UPDATE SET type=excluded.type,quote=excluded.quote,
       environment=excluded.environment,confidence=excluded.confidence,
       observed_at=excluded.observed_at,updated_at=now()`,
    [
      id,
      candidate.org_id,
      candidate.author_name || (candidate.author_id ? `Discord member ${candidate.author_id}` : "Discord contributor"),
      type,
      `Discord server ${candidate.guild_id} · channel ${candidate.channel_id}`,
      candidate.confidence,
      discordObservedAt(candidate.message_id),
      candidate.content,
      `discord:${candidate.guild_id}:${candidate.channel_id}`,
      candidate.message_id,
    ],
  );
  await client.query(
    `INSERT INTO discord_feedback_sources(
       org_id,feedback_id,guild_id,channel_id,message_id,author_id,author_name
     ) VALUES($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT(org_id,feedback_id) DO UPDATE SET
       author_id=excluded.author_id,author_name=excluded.author_name`,
    [
      candidate.org_id, id, candidate.guild_id, candidate.channel_id,
      candidate.message_id, candidate.author_id, candidate.author_name,
    ],
  );
  await client.query(
    `UPDATE discord_intake_candidates
        SET state='Confirmed',promoted_feedback_id=$3,updated_at=now()
      WHERE org_id=$1 AND id=$2`,
    [candidate.org_id, candidate.id, id],
  );
  return id;
}

async function stageDiscordCandidate(input: {
  orgId: string;
  guildId: string;
  channelId: string;
  messageId: string;
  authorId: string | null;
  authorName: string | null;
  submittedById: string | null;
  content: string;
  directReport: boolean;
}): Promise<DiscordCandidateRow> {
  const clean = redactUntrustedText(input.content).replace(/\s+/g, " ").trim().slice(0, 8_000);
  if (!clean) throw new HttpError(400, "Discord feedback cannot be empty.");
  const decision = classifySlackConversation({ text: clean, directMention: input.directReport });
  const id = candidateId(input.guildId, input.channelId, input.messageId);
  const state = input.directReport ? "Review" : decision.state;
  const reason = input.directReport
    ? "A Discord member explicitly submitted this report; confirmation is required before recording it."
    : decision.reason;
  const result = await databasePool().query<DiscordCandidateRow>(
    `INSERT INTO discord_intake_candidates(
       id,org_id,guild_id,channel_id,message_id,author_id,author_name,
       submitted_by_id,content,
       classification,confidence,decision_reason,state
     ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     ON CONFLICT(org_id,guild_id,channel_id,message_id) DO UPDATE SET
       content=excluded.content,classification=excluded.classification,
       confidence=excluded.confidence,decision_reason=excluded.decision_reason,
       submitted_by_id=COALESCE(discord_intake_candidates.submitted_by_id,excluded.submitted_by_id),
       state=CASE WHEN discord_intake_candidates.state IN ('Confirmed','Ignored')
         THEN discord_intake_candidates.state ELSE excluded.state END,
       updated_at=now()
     RETURNING *`,
    [
      id, input.orgId, input.guildId, input.channelId, input.messageId,
      input.authorId, input.authorName, input.submittedById, clean,
      decision.classification, decision.confidence, reason, state,
    ],
  );
  return result.rows[0];
}

export async function processDiscordMessage(
  message: DiscordMessageEvent,
  options: {
    forceReport?: boolean;
    postConfirmation?: boolean;
    confirmationActorId?: string;
  } = {},
): Promise<DiscordIntakeResult | null> {
  if (!message.guild_id || !message.author?.id || message.author.bot || message.webhook_id) return null;
  const resolved = await getDiscordInstallationByGuild(message.guild_id);
  if (!resolved) return null;
  const { orgId, installation } = resolved;
  const mentioned = (message.mentions ?? []).some((mention) => mention.id === installation.botUserId);
  const directReport = Boolean(options.forceReport || mentioned);
  const monitored =
    installation.intakeMode === "channels" &&
    installation.monitoredChannelIds.includes(message.channel_id);
  if (!directReport && !monitored) return null;
  const content = stripDiscordMention(message.content ?? "", installation.botUserId);
  const candidate = await stageDiscordCandidate({
    orgId,
    guildId: message.guild_id,
    channelId: message.channel_id,
    messageId: message.id,
    authorId: message.author.id,
    authorName: message.author.global_name || message.author.username || null,
    submittedById: directReport
      ? options.confirmationActorId || message.author.id
      : null,
    content,
    directReport,
  });

  if (candidate.state === "Confirmed") {
    await transaction(async (client) => promoteDiscordCandidate(client, candidate));
    void analyzeAndClusterSlackSignals(orgId).catch((error) =>
      console.error("Discord feedback analysis failed", { orgId, error }),
    );
  } else if (candidate.state === "Review" && options.postConfirmation !== false) {
    const claimed = await databasePool().query(
      `UPDATE discord_intake_candidates SET confirmation_sent_at=now(),updated_at=now()
        WHERE org_id=$1 AND id=$2 AND confirmation_sent_at IS NULL
        RETURNING id`,
      [orgId, candidate.id],
    );
    if (claimed.rowCount) {
      try {
        await postDiscordMessage(message.channel_id, {
          content: `CloseSpan found possible **${candidate.classification.toLowerCase()}** feedback. Nothing has been recorded yet.`,
          message_reference: { message_id: message.id, fail_if_not_exists: false },
          allowed_mentions: { parse: [], replied_user: false },
          components: confirmationComponents(candidate),
        });
      } catch (error) {
        await databasePool().query(
          `UPDATE discord_intake_candidates SET confirmation_sent_at=NULL,updated_at=now()
            WHERE org_id=$1 AND id=$2 AND state='Review'`,
          [orgId, candidate.id],
        );
        throw error;
      }
    }
  }
  return {
    candidateId: candidate.id,
    state: candidate.state,
    classification: candidate.classification,
    reason: candidate.decision_reason,
    recorded: candidate.state === "Confirmed",
  };
}

export async function reviewDiscordCandidate(input: {
  guildId: string;
  candidateId: string;
  decision: "confirm" | "ignore";
  actorId: string;
}): Promise<{ state: "Confirmed" | "Ignored"; classification: string; recorded: boolean }> {
  const resolved = await getDiscordInstallationByGuild(input.guildId);
  if (!resolved) throw new HttpError(409, "This Discord server is not connected to CloseSpan.");
  const reviewed = await transaction(async (client) => {
    const result = await client.query<DiscordCandidateRow>(
      `SELECT * FROM discord_intake_candidates
        WHERE org_id=$1 AND guild_id=$2 AND id=$3 FOR UPDATE`,
      [resolved.orgId, input.guildId, input.candidateId],
    );
    const candidate = result.rows[0];
    if (!candidate) throw new HttpError(404, "This Discord report is no longer available.");
    if (candidate.submitted_by_id && candidate.submitted_by_id !== input.actorId) {
      throw new HttpError(403, "Only the member who submitted this report can confirm it.");
    }
    if (candidate.state === "Confirmed") {
      return { state: "Confirmed" as const, classification: candidate.classification, recorded: true };
    }
    if (candidate.state === "Ignored") {
      return { state: "Ignored" as const, classification: candidate.classification, recorded: false };
    }
    if (input.decision === "ignore") {
      await client.query(
        `UPDATE discord_intake_candidates SET state='Ignored',updated_at=now()
          WHERE org_id=$1 AND id=$2 AND promoted_feedback_id IS NULL`,
        [resolved.orgId, candidate.id],
      );
      return { state: "Ignored" as const, classification: candidate.classification, recorded: false };
    }
    await promoteDiscordCandidate(client, candidate);
    return { state: "Confirmed" as const, classification: candidate.classification, recorded: true };
  });
  if (reviewed.recorded) {
    void analyzeAndClusterSlackSignals(resolved.orgId).catch((error) =>
      console.error("Discord feedback analysis failed", { orgId: resolved.orgId, error }),
    );
  }
  return reviewed;
}

export function discordConfirmationComponents(candidateId: string) {
  return confirmationComponents({ id: candidateId });
}
