import { createHash } from "node:crypto";

export type NangoRecordAction = "ADDED" | "UPDATED" | "DELETED";

export interface NormalizedFeedbackRecord {
  externalId: string;
  payloadHash: string;
  action: NangoRecordAction;
  nangoCursor: string | null;
  outcome: "Ingested" | "Deleted" | "Skipped";
  feedback: {
    id: string;
    source: string;
    customerName: string;
    accountTier: "Enterprise" | "Growth" | "Starter";
    arr: number;
    type: "Bug" | "Feature request" | "Usability" | "Question" | "Incident";
    severity: "Critical" | "High" | "Medium" | "Low";
    environment: string;
    confidence: number;
    observedAt: string;
    quote: string;
  } | null;
}

const MAX_EXTERNAL_ID_LENGTH = 512;
const MAX_QUOTE_LENGTH = 10_000;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function pathValue(
  value: Record<string, unknown>,
  path: readonly string[],
): unknown {
  let current: unknown = value;
  for (const key of path) {
    if (!isObject(current)) return undefined;
    current = current[key];
  }
  return current;
}

function cleanText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const text = String(value)
    .replace(/<[^>]*>/g, " ")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return null;
  return text.slice(0, maxLength);
}

function firstText(
  record: Record<string, unknown>,
  paths: readonly (readonly string[])[],
  maxLength: number,
): string | null {
  for (const path of paths) {
    const value = cleanText(pathValue(record, path), maxLength);
    if (value) return value;
  }
  return null;
}

function recordHash(record: Record<string, unknown>): string {
  let serialized: string;
  try {
    serialized = JSON.stringify(record);
  } catch {
    serialized = "[unserializable-record]";
  }
  return createHash("sha256").update(serialized).digest("hex");
}

function externalId(record: Record<string, unknown>): string | null {
  const raw = cleanText(record.id, 8_192);
  if (!raw) return null;
  if (raw.length <= MAX_EXTERNAL_ID_LENGTH) return raw;
  return `sha256:${createHash("sha256").update(raw).digest("hex")}`;
}

function recordAction(record: Record<string, unknown>): NangoRecordAction {
  const metadata = isObject(record._nango_metadata)
    ? record._nango_metadata
    : {};
  const raw = typeof metadata.last_action === "string"
    ? metadata.last_action.toUpperCase()
    : "UPDATED";
  return raw === "ADDED" || raw === "DELETED" ? raw : "UPDATED";
}

function recordCursor(record: Record<string, unknown>): string | null {
  const metadata = isObject(record._nango_metadata)
    ? record._nango_metadata
    : {};
  return cleanText(metadata.cursor, 8_192);
}

function observedAt(
  record: Record<string, unknown>,
  fallback: Date,
): string {
  const candidate = firstText(
    record,
    [
      ["observed_at"],
      ["observedAt"],
      ["created_at"],
      ["createdAt"],
      ["submitted_at"],
      ["submittedAt"],
      ["date"],
      ["timestamp"],
      ["_nango_metadata", "last_modified_at"],
      ["_nango_metadata", "first_seen_at"],
    ],
    160,
  );
  if (!candidate) return fallback.toISOString();
  const timestamp = Date.parse(candidate);
  return Number.isFinite(timestamp)
    ? new Date(timestamp).toISOString()
    : fallback.toISOString();
}

function feedbackType(
  record: Record<string, unknown>,
  quote: string,
): NormalizedFeedbackRecord["feedback"] extends infer T
  ? T extends { type: infer Type }
    ? Type
    : never
  : never {
  const raw = `${firstText(record, [["type"], ["category"], ["kind"]], 80) ?? ""} ${quote}`.toLowerCase();
  if (/\b(outage|incident|unavailable|downtime)\b/.test(raw)) return "Incident";
  if (/\b(feature|enhancement|request|wish|idea)\b/.test(raw))
    return "Feature request";
  if (/\b(confus|difficult|hard to use|usability|ux)\b/.test(raw))
    return "Usability";
  if (/\b(bug|error|broken|crash|fail(?:s|ed|ing)?|incorrect)\b/.test(raw))
    return "Bug";
  return "Question";
}

function severity(
  record: Record<string, unknown>,
  quote: string,
): "Critical" | "High" | "Medium" | "Low" {
  const raw = `${firstText(record, [["severity"], ["priority"]], 80) ?? ""} ${quote}`.toLowerCase();
  if (/\b(critical|urgent|p0|sev[ -]?0|blocker)\b/.test(raw)) return "Critical";
  if (/\b(high|p1|sev[ -]?1|major)\b/.test(raw)) return "High";
  if (/\b(low|p3|p4|minor)\b/.test(raw)) return "Low";
  return "Medium";
}

function accountTier(
  record: Record<string, unknown>,
): "Enterprise" | "Growth" | "Starter" {
  const tier = firstText(
    record,
    [["account_tier"], ["accountTier"], ["customer", "tier"], ["account", "tier"]],
    80,
  )?.toLowerCase();
  if (tier?.includes("enterprise")) return "Enterprise";
  if (tier?.includes("starter") || tier?.includes("free")) return "Starter";
  return "Growth";
}

function arr(record: Record<string, unknown>): number {
  const value = pathValue(record, ["arr"]) ?? pathValue(record, ["account", "arr"]);
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.min(Math.round(parsed), 2_147_483_647);
}

const sourceByIntegration: Record<string, string> = {
  int_zendesk: "Zendesk",
  int_intercom: "Intercom",
  int_slack: "Slack",
  int_app_store: "Apple App Store",
  int_play_store: "Google Play Store",
  int_github: "GitHub",
};

const quotePaths = [
  ["quote"],
  ["text"],
  ["body"],
  ["content"],
  ["description"],
  ["review"],
  ["comment"],
  ["message", "text"],
  ["message", "body"],
  ["message", "content"],
  ["ticket", "description"],
  ["conversation", "body"],
  ["review", "text"],
  ["review", "body"],
  ["review", "content"],
  ["summary"],
  ["title"],
  ["subject"],
] as const;

const customerPaths = [
  ["customer_name"],
  ["customerName"],
  ["requester_name"],
  ["requesterName"],
  ["customer", "name"],
  ["requester", "name"],
  ["author", "name"],
  ["user", "name"],
  ["customer", "email"],
  ["requester", "email"],
  ["author", "email"],
  ["user", "email"],
] as const;

export function normalizeNangoRecord(
  value: unknown,
  context: {
    orgId: string;
    integrationId: string;
    sourceNamespace?: string;
  },
  now = new Date(),
): NormalizedFeedbackRecord | null {
  if (!isObject(value)) return null;
  const id = externalId(value);
  if (!id) return null;
  const action = recordAction(value);
  const payloadHash = recordHash(value);
  const nangoCursor = recordCursor(value);
  if (action === "DELETED") {
    return {
      externalId: id,
      payloadHash,
      action,
      nangoCursor,
      outcome: "Deleted",
      feedback: null,
    };
  }

  const quote = firstText(value, quotePaths, MAX_QUOTE_LENGTH);
  if (!quote) {
    return {
      externalId: id,
      payloadHash,
      action,
      nangoCursor,
      outcome: "Skipped",
      feedback: null,
    };
  }
  const deterministicId = createHash("sha256")
    .update(
      `${context.orgId}\0${context.integrationId}\0${context.sourceNamespace ?? "direct"}\0${id}`,
    )
    .digest("hex")
    .slice(0, 32);
  return {
    externalId: id,
    payloadHash,
    action,
    nangoCursor,
    outcome: "Ingested",
    feedback: {
      id: `fb_nango_${deterministicId}`,
      source: sourceByIntegration[context.integrationId] ?? "Connected app",
      customerName: firstText(value, customerPaths, 255) ?? "Unknown customer",
      accountTier: accountTier(value),
      arr: arr(value),
      type: feedbackType(value, quote),
      severity: severity(value, quote),
      environment:
        firstText(
          value,
          [["environment"], ["platform"], ["device", "platform"]],
          160,
        ) ?? "Unspecified",
      confidence: 0.75,
      observedAt: observedAt(value, now),
      quote,
    },
  };
}
