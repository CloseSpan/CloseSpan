import { createHash } from "node:crypto";
import { persistenceMode, transaction } from "./db";
import { getPipedreamClient, pipedreamExternalUserId } from "./pipedream";
import type { PipedreamConnectorId } from "./pipedream-connectors";
import { redactUntrustedText } from "./redaction";
import {
  getPipedreamConnection,
  claimPipedreamImport,
  listPipedreamConnections,
  updatePipedreamImportState,
} from "./pipedream-repository";

const SUPPORTED_MANUAL_IMPORTS = new Set<PipedreamConnectorId>(["int_zendesk"]);
const MAX_PAGES = 5;

type FeedbackType = "Bug" | "Feature request" | "Usability" | "Question" | "Incident";
type FeedbackSeverity = "Critical" | "High" | "Medium" | "Low";

interface NormalizedFeedback {
  externalId: string;
  quote: string;
  customer: string;
  type: FeedbackType;
  severity: FeedbackSeverity;
  redacted: boolean;
  environment: string;
  observedAt: string;
}

export interface ManualImportResult {
  integrationId: PipedreamConnectorId;
  accountId: string;
  accountName: string | null;
  fetched: number;
  created: number;
  updated: number;
  skipped: number;
}

function object(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function cleanText(value: unknown, max = 10_000): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const text = String(value)
    .replace(/<[^>]*>/g, " ")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text ? text.slice(0, max) : null;
}

function zendeskType(ticket: Record<string, unknown>, quote: string): FeedbackType {
  const text = `${cleanText(ticket.type, 80) ?? ""} ${quote}`.toLowerCase();
  if (/\b(outage|incident|unavailable|downtime)\b/.test(text)) return "Incident";
  if (/\b(feature|enhancement|request|wish|idea)\b/.test(text)) return "Feature request";
  if (/\b(confus|difficult|hard to use|usability|ux)\b/.test(text)) return "Usability";
  if (/\b(bug|error|broken|crash|fail(?:s|ed|ing)?|incorrect)\b/.test(text)) return "Bug";
  return "Question";
}

function zendeskSeverity(ticket: Record<string, unknown>, quote: string): FeedbackSeverity {
  const text = `${cleanText(ticket.priority, 40) ?? ""} ${quote}`.toLowerCase();
  if (/\b(urgent|critical|blocker|p0)\b/.test(text)) return "Critical";
  if (/\b(high|major|p1)\b/.test(text)) return "High";
  if (/\b(low|minor|p3|p4)\b/.test(text)) return "Low";
  return "Medium";
}

function normalizeZendeskTicket(value: unknown): NormalizedFeedback | null {
  const ticket = object(value);
  if (!ticket) return null;
  const externalId = cleanText(ticket.id, 512);
  const quote = cleanText(ticket.description) ?? cleanText(ticket.subject);
  if (!externalId || !quote) return null;
  const safeQuote = redactUntrustedText(quote);
  const requester = cleanText(ticket.requester_id, 120);
  const organization = cleanText(ticket.organization_id, 120);
  const created = cleanText(ticket.created_at, 160);
  const timestamp = created ? Date.parse(created) : Number.NaN;
  const tags = Array.isArray(ticket.tags)
    ? ticket.tags.map((tag) => cleanText(tag, 80)).filter(Boolean).slice(0, 8).join(", ")
    : "";
  return {
    externalId,
    quote: safeQuote,
    customer: organization
      ? `Zendesk organization #${organization}`
      : requester ? `Zendesk requester #${requester}` : "Zendesk customer",
    type: zendeskType(ticket, quote),
    severity: zendeskSeverity(ticket, quote),
    redacted: safeQuote !== quote,
    environment: tags || "Zendesk support",
    observedAt: Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : new Date().toISOString(),
  };
}

async function fetchZendeskTickets(accountId: string, orgId: string): Promise<unknown[]> {
  const client = getPipedreamClient();
  const externalUserId = pipedreamExternalUserId(orgId);
  const accounts = await client.accounts.listByExternalUser(externalUserId, { app: "zendesk" });
  const account = accounts.find((candidate) => String(candidate.id) === accountId);
  if (!account || account.app?.nameSlug !== "zendesk") throw new Error("connection_not_available");
  if (account.dead || account.healthy === false) throw new Error("connection_not_available");
  const records: unknown[] = [];
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const response = await client.proxy.get({
      externalUserId,
      accountId,
      url: "/api/v2/tickets.json",
      params: { per_page: "100", page: String(page + 1) },
      headers: { Accept: "application/json" },
    }, { timeoutInSeconds: 30 });
    const body = object(response);
    if (!body) throw new Error("zendesk_response_invalid");
    const results = Array.isArray(body.tickets) ? body.tickets : [];
    records.push(...results);
    const nextPage = cleanText(body.next_page, 2_000);
    if (!nextPage) break;
  }
  return records;
}

async function persistZendeskTickets(input: {
  orgId: string;
  accountId: string;
  records: unknown[];
}): Promise<Omit<ManualImportResult, "integrationId" | "accountId" | "accountName">> {
  const normalized = input.records
    .map(normalizeZendeskTicket)
    .filter((item): item is NormalizedFeedback => item !== null);
  if (persistenceMode() !== "postgres") {
    return { fetched: input.records.length, created: normalized.length, updated: 0, skipped: input.records.length - normalized.length };
  }
  const namespace = `pipedream:${input.accountId}:zendesk:tickets`.slice(0, 255);
  return transaction(async (client) => {
    const existing = await client.query<{ external_id: string }>(
      `SELECT external_id FROM feedback_items
        WHERE org_id=$1 AND integration_id='int_zendesk'
          AND source_namespace=$2 AND external_id=ANY($3::text[])`,
      [input.orgId, namespace, normalized.map((item) => item.externalId)],
    );
    const existingIds = new Set(existing.rows.map((row) => row.external_id));
    for (const item of normalized) {
      const id = `fb_pd_${createHash("sha256").update(`${input.accountId}:${item.externalId}`).digest("hex").slice(0, 24)}`;
      await client.query(
        `INSERT INTO feedback_items(
           id,org_id,source,customer_name,account_tier,arr,type,severity,
           redacted,environment,confidence,observed_at,quote,integration_id,
           source_namespace,external_id
         ) VALUES($1,$2,'Zendesk',$3,'Growth',0,$4,$5,$6,$7,0.78,$8,$9,
                  'int_zendesk',$10,$11)
         ON CONFLICT(org_id,integration_id,source_namespace,external_id)
           WHERE external_id IS NOT NULL
         DO UPDATE SET customer_name=excluded.customer_name,type=excluded.type,
           severity=excluded.severity,redacted=excluded.redacted,
           environment=excluded.environment,
           confidence=excluded.confidence,observed_at=excluded.observed_at,
           quote=excluded.quote,updated_at=now()`,
        [id,input.orgId,item.customer,item.type,item.severity,item.redacted,item.environment,item.observedAt,item.quote,namespace,item.externalId],
      );
    }
    await client.query(
      `UPDATE integrations SET last_sync_at=now(),error_message=NULL
        WHERE org_id=$1 AND id='int_zendesk'`,
      [input.orgId],
    );
    const updated = normalized.filter((item) => existingIds.has(item.externalId)).length;
    return {
      fetched: input.records.length,
      created: normalized.length - updated,
      updated,
      skipped: input.records.length - normalized.length,
    };
  });
}

export function supportsManualFeedbackImport(integrationId: PipedreamConnectorId): boolean {
  return SUPPORTED_MANUAL_IMPORTS.has(integrationId);
}

export async function pullPipedreamFeedback(input: {
  orgId: string;
  integrationId: PipedreamConnectorId;
  accountId: string;
}): Promise<ManualImportResult> {
  const connection = await getPipedreamConnection(input.orgId, input.integrationId, input.accountId);
  if (!connection || connection.state !== "Connected") throw new Error("connection_not_available");
  if (!supportsManualFeedbackImport(input.integrationId)) throw new Error("manual_import_not_supported");
  if (!(await claimPipedreamImport(input))) throw new Error("import_in_progress");
  try {
    const records = await fetchZendeskTickets(input.accountId, input.orgId);
    const counts = await persistZendeskTickets({ orgId: input.orgId, accountId: input.accountId, records });
    await updatePipedreamImportState({ ...input, status: "Succeeded", count: counts.created + counts.updated, safeError: null });
    return { ...input, accountName: connection.accountName, ...counts };
  } catch (error) {
    await updatePipedreamImportState({ ...input, status: "Failed", safeError: "Feedback could not be pulled. Retry shortly or reconnect this account." });
    throw error;
  }
}

export async function pullAllPipedreamFeedback(orgId: string): Promise<{
  results: ManualImportResult[];
  failed: number;
  unsupported: number;
}> {
  const connections = (await listPipedreamConnections(orgId))
    .filter((connection) => connection.state === "Connected");
  const supported = connections.filter((connection) => supportsManualFeedbackImport(connection.integrationId));
  const results: ManualImportResult[] = [];
  let failed = 0;
  for (const connection of supported) {
    try {
      results.push(await pullPipedreamFeedback({ orgId, integrationId: connection.integrationId, accountId: connection.accountId }));
    } catch {
      failed += 1;
    }
  }
  return { results, failed, unsupported: connections.length - supported.length };
}
