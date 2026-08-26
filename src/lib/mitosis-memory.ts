import { createHash, randomUUID } from "node:crypto";
import type { FeedbackItem } from "./domain";
import { redactUntrustedText } from "./redaction";

const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_FEEDBACK_BATCH = 25;
const MAX_ANSWER_RESULTS = 10;
const MCP_PROTOCOL_VERSION = "2025-03-26";

type Fetcher = typeof fetch;

interface MitosisConfiguration {
  mcpUrl: string;
  bearerToken: string;
  agentSurface: string;
  timeoutMs: number;
}

interface McpContentBlock {
  type?: unknown;
  text?: unknown;
}

interface McpToolResult {
  content?: McpContentBlock[];
  structuredContent?: unknown;
  isError?: boolean;
}

interface McpEnvelope {
  error?: { code?: number; message?: string };
  result?: McpToolResult;
}

export interface MitosisCitation {
  id: string;
  title: string;
  source: string | null;
  excerpt: string | null;
}

export interface MitosisAnswer {
  answer: string;
  citations: MitosisCitation[];
  citedGraphUrl: string | null;
  possibleSourceGap: boolean;
}

export interface MitosisPilotStatus {
  enabled: boolean;
  configured: boolean;
  healthy: boolean;
  officeName: string | null;
  sourceCount: number | null;
  itemCount: number | null;
  message: string;
}

export interface SanitizedMitosisFeedback {
  reference: string;
  sessionId: string;
  title: string;
  turns: Array<{ role: "user" | "assistant"; text: string }>;
}

export interface MitosisSyncResult {
  synced: number;
  skipped: number;
  references: string[];
}

export class MitosisConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MitosisConfigurationError";
  }
}

export class MitosisRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MitosisRequestError";
  }
}

function boundedTimeout(value: string | undefined): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_TIMEOUT_MS;
  return Math.max(1_000, Math.min(60_000, Math.floor(parsed)));
}

function enabled(): boolean {
  return process.env.MITOSIS_PILOT_ENABLED?.trim().toLowerCase() === "true";
}

function configurationForOrganization(orgId: string): MitosisConfiguration {
  if (!enabled())
    throw new MitosisConfigurationError(
      "The Mitosis memory pilot is disabled. Enable it explicitly on the server before syncing data.",
    );

  const allowedOrgId = process.env.MITOSIS_PILOT_ORG_ID?.trim();
  if (!allowedOrgId || allowedOrgId !== orgId)
    throw new MitosisConfigurationError(
      "This workspace is not allowlisted for the isolated Mitosis pilot.",
    );

  const configuredUrl = process.env.MITOSIS_MCP_URL?.trim();
  const bearerToken = process.env.MITOSIS_API_KEY?.trim();
  if (!configuredUrl || !bearerToken)
    throw new MitosisConfigurationError(
      "Add the server-only Mitosis MCP URL and API key before using the pilot.",
    );

  let url: URL;
  try {
    url = new URL(configuredUrl);
  } catch {
    throw new MitosisConfigurationError("MITOSIS_MCP_URL must be a valid URL.");
  }
  const loopback = new Set(["localhost", "127.0.0.1", "::1"]);
  if (
    url.username ||
    url.password ||
    (url.protocol !== "https:" && !loopback.has(url.hostname)) ||
    !url.pathname.startsWith("/api/mcp/o/")
  ) {
    throw new MitosisConfigurationError(
      "MITOSIS_MCP_URL must be a credential-free HTTPS office endpoint.",
    );
  }
  if (bearerToken.length < 16)
    throw new MitosisConfigurationError("MITOSIS_API_KEY is not a valid bearer credential.");
  const agentSurface = process.env.MITOSIS_AGENT_SURFACE?.trim() || "closespan";
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{1,63}$/.test(agentSurface))
    throw new MitosisConfigurationError(
      "MITOSIS_AGENT_SURFACE must be a short framework identifier.",
    );

  return {
    mcpUrl: url.toString(),
    bearerToken,
    agentSurface,
    timeoutMs: boundedTimeout(process.env.MITOSIS_TIMEOUT_MS),
  };
}

function publicConfigurationMessage(orgId: string): Pick<
  MitosisPilotStatus,
  "enabled" | "configured" | "message"
> {
  if (!enabled()) {
    return {
      enabled: false,
      configured: false,
      message: "Disabled by default. No CloseSpan data is sent to Mitosis.",
    };
  }
  try {
    configurationForOrganization(orgId);
    return {
      enabled: true,
      configured: true,
      message: "Configured for this workspace only.",
    };
  } catch (error) {
    return {
      enabled: true,
      configured: false,
      message: error instanceof Error ? error.message : "The pilot is not configured.",
    };
  }
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    throw new MitosisRequestError("Mitosis returned an unreadable response.");
  }
}

function toolPayload(result: McpToolResult): unknown {
  if (result.structuredContent !== undefined) return result.structuredContent;
  const text = result.content
    ?.filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text as string)
    .join("\n")
    .trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function callTool(
  orgId: string,
  name: "cortex_ask" | "cortex_ingest_conversation" | "cortex_status",
  args: Record<string, unknown>,
  fetcher: Fetcher = fetch,
): Promise<unknown> {
  const config = configurationForOrganization(orgId);
  let response: Response;
  try {
    response = await fetcher(config.mcpUrl, {
      method: "POST",
      signal: AbortSignal.timeout(config.timeoutMs),
      headers: {
        Accept: "application/json, text/event-stream",
        Authorization: `Bearer ${config.bearerToken}`,
        "Content-Type": "application/json",
        "Mcp-Protocol-Version": MCP_PROTOCOL_VERSION,
        "X-Mitosis-Agent": config.agentSurface,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: randomUUID(),
        method: "tools/call",
        params: { name, arguments: args },
      }),
      cache: "no-store",
    });
  } catch {
    throw new MitosisRequestError("Mitosis could not be reached.");
  }

  const payload = (await readJson(response)) as McpEnvelope | null;
  if (!response.ok) {
    throw new MitosisRequestError(
      response.status === 401
        ? "The Mitosis credential is missing, expired, or revoked."
        : `Mitosis returned HTTP ${response.status}.`,
    );
  }
  if (payload?.error) {
    throw new MitosisRequestError(
      payload.error.message?.slice(0, 300) || "Mitosis rejected the request.",
    );
  }
  if (!payload?.result)
    throw new MitosisRequestError("Mitosis returned no tool result.");
  if (payload.result.isError) {
    const detail = toolPayload(payload.result);
    const structuredMessage = firstString(
      detail,
      new Set(["error", "message", "detail", "reason"]),
    );
    throw new MitosisRequestError(
      typeof detail === "string"
        ? detail.slice(0, 300)
        : structuredMessage?.slice(0, 300) || "Mitosis could not complete the request.",
    );
  }
  return toolPayload(payload.result);
}

function safeReference(orgId: string, feedbackId: string): string {
  return createHash("sha256")
    .update(`${orgId}:${feedbackId}`)
    .digest("hex")
    .slice(0, 20);
}

function normalizedText(value: string, maxLength: number): string {
  return redactUntrustedText(value)
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

export function sanitizeFeedbackForMitosis(
  orgId: string,
  item: FeedbackItem,
): SanitizedMitosisFeedback | null {
  if (item.orgId !== orgId || !item.redacted) return null;
  const reference = safeReference(orgId, item.id);
  const quote = normalizedText(item.quote, 4_000);
  const environment = normalizedText(item.environment, 500);
  const observedAt = normalizedText(item.observedAt, 200);
  if (!quote) return null;

  return {
    reference,
    sessionId: `closespan-feedback-${reference}`,
    title: `CloseSpan sanitized feedback ${reference}`,
    turns: [
      {
        role: "user",
        text: [
          `CLOSESPAN_FEEDBACK_REF:${reference}`,
          `Feedback: ${quote}`,
        ].join("\n"),
      },
      {
        role: "assistant",
        text: [
          "CloseSpan normalized this redacted product signal for the memory pilot.",
          `Type: ${item.type}`,
          `Severity: ${item.severity}`,
          `Source: ${item.source}`,
          `Environment: ${environment || "Not provided"}`,
          `Observed: ${observedAt || "Not provided"}`,
        ].join("\n"),
      },
    ],
  };
}

export async function syncSanitizedFeedbackToMitosis(input: {
  orgId: string;
  feedback: FeedbackItem[];
  fetcher?: Fetcher;
}): Promise<MitosisSyncResult> {
  if (input.feedback.length > MAX_FEEDBACK_BATCH)
    throw new MitosisRequestError(`Sync at most ${MAX_FEEDBACK_BATCH} feedback records at a time.`);

  const sanitized = input.feedback
    .map((item) => sanitizeFeedbackForMitosis(input.orgId, item))
    .filter((item): item is SanitizedMitosisFeedback => Boolean(item));
  const skipped = input.feedback.length - sanitized.length;
  if (sanitized.length === 0)
    throw new MitosisRequestError(
      "No eligible records were found. Only feedback already marked redacted can enter the pilot.",
    );

  for (const record of sanitized) {
    await callTool(
      input.orgId,
      "cortex_ingest_conversation",
      {
        turns: record.turns,
        session_id: record.sessionId,
        title: record.title,
      },
      input.fetcher,
    );
  }
  return {
    synced: sanitized.length,
    skipped,
    references: sanitized.map((record) => record.reference),
  };
}

function walk(value: unknown, visit: (key: string, value: unknown) => void): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) walk(item, visit);
    return;
  }
  for (const [key, nested] of Object.entries(value)) {
    visit(key, nested);
    walk(nested, visit);
  }
}

function firstString(value: unknown, keys: Set<string>): string | null {
  if (typeof value === "string") return normalizedText(value, 8_000) || null;
  let result: string | null = null;
  walk(value, (key, nested) => {
    if (!result && keys.has(key) && typeof nested === "string") {
      result = normalizedText(nested, 8_000) || null;
    }
  });
  return result;
}

function firstNumber(value: unknown, keys: Set<string>): number | null {
  let result: number | null = null;
  walk(value, (key, nested) => {
    if (result === null && keys.has(key) && typeof nested === "number" && Number.isFinite(nested)) {
      result = nested;
    }
  });
  return result;
}

function safeGraphUrl(value: unknown): string | null {
  const candidate = firstString(value, new Set(["cited_graph_url"]));
  if (!candidate) return null;
  try {
    const url = new URL(candidate);
    return url.protocol === "https:" && url.hostname === "mitosislabs.ai"
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

function normalizeCitation(value: unknown, index: number): MitosisCitation | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const id = [row.universal_id, row.id, row.source_universal_id]
    .find((candidate) => typeof candidate === "string") as string | undefined;
  const excerpt = [row.excerpt, row.snippet, row.preview, row.text, row.content]
    .find((candidate) => typeof candidate === "string") as string | undefined;
  const title = [row.title, row.name, row.subject]
    .find((candidate) => typeof candidate === "string") as string | undefined;
  const source = [row.source, row.source_table, row.provider]
    .find((candidate) => typeof candidate === "string") as string | undefined;
  if (!id && !excerpt && !title) return null;
  return {
    id: normalizedText(id ?? `citation-${index + 1}`, 300),
    title: normalizedText(title ?? `Evidence ${index + 1}`, 300),
    source: source ? normalizedText(source, 200) : null,
    excerpt: excerpt ? normalizedText(excerpt, 1_000) : null,
  };
}

function citationsFromPayload(value: unknown): MitosisCitation[] {
  const candidates: unknown[] = [];
  walk(value, (key, nested) => {
    if (["citations", "results", "matches", "items"].includes(key) && Array.isArray(nested)) {
      candidates.push(...nested);
    }
  });
  const citations: MitosisCitation[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    const citation = normalizeCitation(candidate, citations.length);
    if (!citation || seen.has(citation.id)) continue;
    seen.add(citation.id);
    citations.push(citation);
    if (citations.length === MAX_ANSWER_RESULTS) break;
  }
  return citations;
}

export function normalizeMitosisAnswer(payload: unknown): MitosisAnswer {
  const answer = firstString(
    payload,
    new Set(["answer", "summary", "response", "result_text", "text"]),
  );
  const citations = citationsFromPayload(payload);
  return {
    answer: answer ?? (
      citations.length > 0
        ? `Mitosis retrieved ${citations.length} matching memory ${citations.length === 1 ? "record" : "records"}. Review the cited evidence before drawing a conclusion.`
        : "Mitosis did not return matching evidence or a synthesized answer."
    ),
    citations,
    citedGraphUrl: safeGraphUrl(payload),
    possibleSourceGap: Boolean(
      payload &&
      typeof payload === "object" &&
      ("source_gap" in payload || "possible_source_gap" in payload || "memory_state" in payload),
    ),
  };
}

export async function askMitosisMemory(input: {
  orgId: string;
  question: string;
  limit?: number;
  fetcher?: Fetcher;
}): Promise<MitosisAnswer> {
  const question = normalizedText(input.question, 2_000);
  if (question.length < 3)
    throw new MitosisRequestError("Enter a question with at least 3 characters.");
  const limit = Math.max(1, Math.min(MAX_ANSWER_RESULTS, Math.floor(input.limit ?? 5)));
  const payload = await callTool(
    input.orgId,
    "cortex_ask",
    { question, limit },
    input.fetcher,
  );
  return normalizeMitosisAnswer(payload);
}

export async function checkMitosisPilotStatus(
  orgId: string,
  fetcher?: Fetcher,
): Promise<MitosisPilotStatus> {
  const current = publicConfigurationMessage(orgId);
  if (!current.configured) {
    return {
      ...current,
      healthy: false,
      officeName: null,
      sourceCount: null,
      itemCount: null,
    };
  }
  try {
    const payload = await callTool(orgId, "cortex_status", {}, fetcher);
    return {
      ...current,
      healthy: true,
      officeName: firstString(payload, new Set(["office_name", "officeName"])),
      sourceCount: firstNumber(payload, new Set(["source_count", "sourceCount"])),
      itemCount: firstNumber(payload, new Set(["item_count", "itemCount", "total_items"])),
      message: "Connected. Admins may sync sanitized records or run a pilot query.",
    };
  } catch (error) {
    return {
      ...current,
      healthy: false,
      officeName: null,
      sourceCount: null,
      itemCount: null,
      message: error instanceof Error ? error.message : "Mitosis is unavailable.",
    };
  }
}
