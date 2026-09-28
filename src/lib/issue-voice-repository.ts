import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { databasePool, transaction } from "./db";
import { HttpError, type RequestContext } from "./request-security";
import { workspacePersistenceMode } from "./workspace-persistence";
import { readPresentationDemo } from "./presentation-demo";
import { loadRetellConnection } from "./retell-repository";
import { readIssueConversation, readIssueConversationContext } from "./issue-conversation-repository";
import { boundedIssueConversationEvidence } from "./issue-conversation";
import { getEngineeringWorkflow } from "./engineering-workflow-repository";
import { readIssueWorkspaceContext } from "./issue-workspace-context";
import { ISSUE_VOICE_DURATION_MS, type IssueVoiceAvailability, type IssueVoiceLink } from "./issue-voice";
import { issueVoiceCallBody, verifyIssueVoiceAgent, voiceProviderRequest } from "./issue-voice-provider";

type VoiceContext = Pick<RequestContext, "orgId" | "actorId" | "role">;
const REQUESTED = "Started an issue voice session";
const ENDED = "Ended an issue voice session";
const SESSION_WINDOW_MS = 10 * 60_000;
const ticketSchema = z.object({ orgId: z.string(), actorId: z.string(), problemId: z.string(),
  sessionId: z.string().uuid(), callId: z.string().regex(/^call_[a-zA-Z0-9_-]+$/), expiresAt: z.number() }).strict();
type VoiceTicket = z.infer<typeof ticketSchema>;

function signingKey(): string {
  const key = process.env.CLOSESPAN_RETELL_SIGNING_KEY || process.env.AUTH_SECRET || process.env.AI_CREDENTIAL_ENCRYPTION_KEY;
  if (!key || key.length < 32) throw new HttpError(503, "Voice setup is not complete. You can continue in text.");
  return key;
}

function configuredFor(orgId: string): boolean {
  if (!process.env.CLOSESPAN_RETELL_AGENT_ID) return false;
  const allowed = (process.env.CLOSESPAN_RETELL_ALLOWED_ORG_IDS ?? "").split(",").map((item) => item.trim());
  if (!allowed.includes(orgId)) return false;
  return Boolean(process.env.CLOSESPAN_RETELL_API_KEY ||
    (process.env.NODE_ENV === "development" && process.env.CLOSESPAN_RETELL_TEST_ORG_ID === orgId));
}

export async function issueVoiceCredentials(orgId: string) {
  if (!configuredFor(orgId)) throw new HttpError(503, "Voice is not enabled for this workspace yet. You can continue in text.");
  let apiKey = process.env.CLOSESPAN_RETELL_API_KEY;
  // Explicit owner-approved LOCAL test only. Never implicitly reuse an intake key in production.
  if (!apiKey && process.env.NODE_ENV === "development" && process.env.CLOSESPAN_RETELL_TEST_ORG_ID === orgId)
    apiKey = (await loadRetellConnection({ orgId }))?.apiKey;
  if (!apiKey) throw new HttpError(503, "Voice setup is not complete. You can continue in text.");
  signingKey();
  return { apiKey, agentId: process.env.CLOSESPAN_RETELL_AGENT_ID! };
}

async function requireVoiceIssue(context: VoiceContext, problemId: string) {
  if (!["Admin", "Contributor"].includes(context.role)) throw new HttpError(403, "Contributor permission is required for voice.");
  if (process.env.APP_MODE === "demo" || workspacePersistenceMode(context.orgId) !== "postgres" || await readPresentationDemo(context.orgId))
    throw new HttpError(403, "Voice is available in a live workspace, not the read-only demo.");
  const issue = await databasePool().query("SELECT 1 FROM product_problems WHERE org_id=$1 AND id=$2", [context.orgId, problemId]);
  if (!issue.rowCount) throw new HttpError(404, "Issue was not found.");
}

export async function issueVoiceAvailability(context: VoiceContext, problemId: string): Promise<IssueVoiceAvailability> {
  await requireVoiceIssue(context, problemId);
  const available = configuredFor(context.orgId);
  return { available, links: [], ...(!available ? { reason: "Voice is not enabled for this workspace yet. You can continue in text." } : {}) };
}

export function signVoiceTicket(ticket: VoiceTicket): string {
  const payload = Buffer.from(JSON.stringify(ticket)).toString("base64url");
  return `${payload}.${createHmac("sha256", signingKey()).update(payload).digest("base64url")}`;
}

export function verifyVoiceTicket(token: string, context: VoiceContext, problemId: string): VoiceTicket {
  const invalid = () => new HttpError(403, "This voice session is invalid or expired. Start a new conversation.");
  if (token.length > 2000) throw invalid();
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra) throw invalid();
  const expected = createHmac("sha256", signingKey()).update(payload).digest();
  const received = Buffer.from(signature, "base64url");
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) throw invalid();
  let ticket: VoiceTicket;
  try { ticket = ticketSchema.parse(JSON.parse(Buffer.from(payload, "base64url").toString("utf8"))); } catch { throw invalid(); }
  if (ticket.orgId !== context.orgId || ticket.actorId !== context.actorId || ticket.problemId !== problemId || ticket.expiresAt <= Date.now()) throw invalid();
  return ticket;
}

async function reserveVoice(context: RequestContext, problemId: string): Promise<string> {
  return transaction(async (client) => {
    // One durable lock per organization, across Node processes and serverless instances.
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`closespan-voice:${context.orgId}`]);
    const dedupeKey = createHash("sha256").update(`${context.actorId}:${context.idempotencyKey}`).digest("hex");
    const duplicate = await client.query("SELECT 1 FROM idempotency_keys WHERE org_id=$1 AND key=$2 AND action='issue-voice'", [context.orgId, dedupeKey]);
    if (duplicate.rowCount) throw new HttpError(409, "This voice request was already used. Start a new conversation.");
    const counts = await client.query<{ total: string; actor: string; active: string; actor_active: string }>(
      `SELECT count(*) AS total,count(*) FILTER(WHERE event.actor_id=$2) AS actor,
        count(*) FILTER(WHERE event.occurred_at>now()-interval '10 minutes' AND NOT EXISTS (
          SELECT 1 FROM audit_events ended WHERE ended.org_id=event.org_id AND ended.trace_id=event.trace_id AND ended.action=$4)) AS active,
        count(*) FILTER(WHERE event.actor_id=$2 AND event.occurred_at>now()-interval '10 minutes' AND NOT EXISTS (
          SELECT 1 FROM audit_events ended WHERE ended.org_id=event.org_id AND ended.trace_id=event.trace_id AND ended.action=$4)) AS actor_active
       FROM audit_events event WHERE event.org_id=$1 AND event.action=$3 AND event.occurred_at>now()-interval '24 hours'`,
      [context.orgId, context.actorId, REQUESTED, ENDED]);
    const count = counts.rows[0];
    if (Number(count.actor_active) > 0) throw new HttpError(409, "End your current voice conversation before starting another.");
    if (Number(count.active) >= 3 || Number(count.total) >= 40 || Number(count.actor) >= 10)
      throw new HttpError(429, "The voice test limit has been reached. You can continue in text.");
    const sessionId = randomUUID();
    await client.query("INSERT INTO idempotency_keys(org_id,key,action) VALUES($1,$2,'issue-voice')", [context.orgId, dedupeKey]);
    await client.query(`INSERT INTO audit_events(id,org_id,actor_id,actor_name,action,entity_type,entity_id,trace_id)
      VALUES($1,$2,$3,$4,$5,'Issue',$6,$7)`, [randomUUID(), context.orgId, context.actorId, context.actorName, REQUESTED, problemId, sessionId]);
    return sessionId;
  });
}

async function closeReservation(context: VoiceContext, problemId: string, sessionId: string) {
  await databasePool().query(`INSERT INTO audit_events(id,org_id,actor_id,actor_name,action,entity_type,entity_id,trace_id)
    VALUES($1,$2,$3,'Workspace member',$4,'Issue',$5,$6) ON CONFLICT(org_id,trace_id,action) DO NOTHING`,
  [randomUUID(), context.orgId, context.actorId, ENDED, problemId, sessionId]);
}

export async function prepareVoiceEvidence(orgId: string, problemId: string) {
  const [context, history, workflow, current] = await Promise.all([
    readIssueConversationContext(orgId, problemId), readIssueConversation(orgId, problemId),
    getEngineeringWorkflow(orgId, problemId), readIssueWorkspaceContext(orgId, problemId),
  ]);
  const links: IssueVoiceLink[] = [];
  if (workflow.run) links.push({ label: "View test results", href: `/agent-runs/${encodeURIComponent(workflow.run.id)}` });
  const preview = workflow.run?.runtimeEvidence?.previewUrl;
  const currentRun = Boolean(workflow.run && workflow.approval && workflow.prompt
    && workflow.run.approvalId === workflow.approval.id && workflow.approval.promptHash === workflow.prompt.contentHash);
  // No provider URL is fetched. Reject credentials and non-web schemes before rendering it.
  if (preview && currentRun && workflow.run?.runtimeEvidence?.healthStatus === "passed") {
    try { const url = new URL(preview); if (url.protocol === "https:" && !url.username && !url.password)
      links.push({ label: "Open test preview", href: url.href }); } catch { /* No valid preview. */ }
  }
  const evidence = boundedIssueConversationEvidence({
    capturedAt: new Date().toISOString(), ...context.evidence, currentVerification: current.verification,
    recentDiscussion: history.messages.slice(-6).map(({ role, content }) => ({ role, content })),
    availableLinks: links, previewNote: "Preview availability is not a test result; an expired environment may need to be reopened.",
  }, 22_000);
  return { evidence: JSON.stringify(evidence), links };
}

export async function startIssueVoice(context: RequestContext, problemId: string) {
  await requireVoiceIssue(context, problemId);
  const { apiKey, agentId } = await issueVoiceCredentials(context.orgId);
  await verifyIssueVoiceAgent(apiKey, agentId);
  const { evidence, links } = await prepareVoiceEvidence(context.orgId, problemId);
  const sessionId = await reserveVoice(context, problemId);
  let callId: string | undefined;
  try {
    const raw = await voiceProviderRequest(apiKey, "/v3/create-web-call", issueVoiceCallBody(agentId, evidence));
    // Keep the scoped ID for cleanup even when another response field is malformed.
    if (typeof raw.call_id === "string" && /^call_[a-zA-Z0-9_-]+$/.test(raw.call_id)) callId = raw.call_id;
    const parsed = z.object({ call_id: z.string().regex(/^call_[a-zA-Z0-9_-]+$/), access_token: z.string().min(1).max(20_000),
      transport: z.enum(["gateway", "livekit"]).optional(),
      ice_servers: z.array(z.object({ urls: z.union([z.string(), z.array(z.string())]), username: z.string().optional(), credential: z.string().optional() })).max(20).optional(),
    }).safeParse(raw);
    if (!parsed.success) throw new HttpError(502, "The voice service returned an invalid session.");
    callId = parsed.data.call_id;
    const ticket = signVoiceTicket({ orgId: context.orgId, actorId: context.actorId, problemId, sessionId, callId, expiresAt: Date.now() + SESSION_WINDOW_MS });
    return { ...parsed.data, ticket, links, maxDurationMs: ISSUE_VOICE_DURATION_MS };
  } catch (error) {
    // Never retry creation automatically. An ambiguous provider timeout still consumes the quota.
    if (callId) await voiceProviderRequest(apiKey, `/v2/stop-call/${encodeURIComponent(callId)}`, {}).catch(() => {});
    await closeReservation(context, problemId, sessionId);
    throw error;
  }
}

export async function authorizeVoiceSession(context: VoiceContext, problemId: string, token: string) {
  await requireVoiceIssue(context, problemId);
  const ticket = verifyVoiceTicket(token, context, problemId);
  const reservation = await databasePool().query(`SELECT 1 FROM audit_events WHERE org_id=$1 AND actor_id=$2 AND entity_id=$3 AND trace_id=$4 AND action=$5`,
    [context.orgId, context.actorId, problemId, ticket.sessionId, REQUESTED]);
  if (!reservation.rowCount) throw new HttpError(403, "This voice session was not found.");
  return { ticket, ...await issueVoiceCredentials(context.orgId) };
}

export async function endIssueVoice(context: VoiceContext, problemId: string, token: string) {
  const { ticket, apiKey } = await authorizeVoiceSession(context, problemId, token);
  try { await voiceProviderRequest(apiKey, `/v2/stop-call/${encodeURIComponent(ticket.callId)}`, {}); }
  catch {
    // A disconnected browser may have already ended it. Verify before releasing the active slot.
    const call = await voiceProviderRequest(apiKey, `/v2/get-call/${encodeURIComponent(ticket.callId)}`);
    if (!["ended", "error", "not_connected"].includes(String(call.call_status)))
      throw new HttpError(503, "The call is disconnecting. It will end at the five-minute limit.");
  }
  await closeReservation(context, problemId, ticket.sessionId);
}
