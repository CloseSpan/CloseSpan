import type { ProductProfile } from "./onboarding-repository";

export type PublicSourceKind =
  | "app_store"
  | "play_store"
  | "review_site"
  | "community"
  | "social"
  | "other";

export type PublicDiscoveryProvider = "you" | "bright_data";

export interface PublicFeedbackSource {
  id: string;
  title: string;
  url: string;
  host: string;
  kind: PublicSourceKind;
  reason: string;
  confidence: "high" | "medium" | "low";
  discoveredBy: PublicDiscoveryProvider;
}

export interface PublicSourceDiscoveryResponse {
  status: "disabled" | "completed" | "unavailable";
  provider: PublicDiscoveryProvider | null;
  sources: PublicFeedbackSource[];
}

export type ImportStatus =
  | "Queued"
  | "Running"
  | "Retrying"
  | "Succeeded"
  | "Failed";

export type IntegrationConnectionState =
  | "Connected"
  | "Needs reconnect"
  | "Disconnected"
  | null;

export interface IntegrationImport {
  id: string;
  syncName: string;
  model: string;
  status: ImportStatus;
  recordsProcessed: number;
  pagesProcessed: number;
  attempts: number;
  queuedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  nextAttemptAt: string | null;
  lastErrorCode: string | null;
}

export interface IntegrationSyncStatusResponse {
  integrationId: string;
  connectionState: IntegrationConnectionState;
  sync: IntegrationImport | null;
}

const PUBLIC_SOURCE_KINDS = new Set<PublicSourceKind>([
  "app_store",
  "play_store",
  "review_site",
  "community",
  "social",
  "other",
]);

const PUBLIC_DISCOVERY_PROVIDERS = new Set<PublicDiscoveryProvider>([
  "you",
  "bright_data",
]);

const IMPORT_STATUSES = new Set<ImportStatus>([
  "Queued",
  "Running",
  "Retrying",
  "Succeeded",
  "Failed",
]);

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function nullableText(value: unknown): string | null {
  return value === null ? null : text(value);
}

function nonNegativeInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}

function isClearlyPrivateHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (
    !host ||
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    !host.includes(".")
  ) {
    return true;
  }

  // URL.hostname retains brackets around IPv6 literals in current browsers.
  if (host.startsWith("[") && host.endsWith("]")) return true;
  const ipv4 = host.split(".");
  return (
    ipv4.length === 4 &&
    ipv4.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255)
  );
}

/**
 * Models sometimes return a bare domain instead of a URL. Normalize that
 * narrow case for the public-discovery request and drop everything that is not
 * a public http(s) product URL.
 */
export function normalizeProductUrl(value: unknown): string | null {
  const candidate = text(value);
  if (!candidate) return null;

  const withProtocol = /^[a-z][a-z\d+.-]*:/i.test(candidate)
    ? candidate
    : `https://${candidate}`;
  try {
    const parsed = new URL(withProtocol);
    if (
      (parsed.protocol !== "https:" && parsed.protocol !== "http:") ||
      parsed.username ||
      parsed.password ||
      isClearlyPrivateHostname(parsed.hostname)
    ) {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

function publicHttpUrl(value: unknown): string | null {
  const candidate = text(value);
  if (!candidate || !/^https?:\/\//i.test(candidate)) return null;
  return normalizeProductUrl(candidate);
}

function parsePublicSource(value: unknown): PublicFeedbackSource | null {
  const item = record(value);
  if (!item) return null;
  const id = text(item.id);
  const title = text(item.title);
  const url = publicHttpUrl(item.url);
  const host = text(item.host);
  const reason = text(item.reason);
  const kind = text(item.kind) as PublicSourceKind | null;
  const confidence = text(item.confidence) as
    | PublicFeedbackSource["confidence"]
    | null;
  const discoveredBy = text(item.discoveredBy) as
    | PublicDiscoveryProvider
    | null;
  if (
    !id ||
    !title ||
    !url ||
    !host ||
    !reason ||
    !kind ||
    !PUBLIC_SOURCE_KINDS.has(kind) ||
    !confidence ||
    !["high", "medium", "low"].includes(confidence) ||
    !discoveredBy ||
    !PUBLIC_DISCOVERY_PROVIDERS.has(discoveredBy)
  ) {
    return null;
  }
  return { id, title, url, host, kind, reason, confidence, discoveredBy };
}

export function parsePublicSourceDiscoveryResponse(
  value: unknown,
): PublicSourceDiscoveryResponse | null {
  const payload = record(value);
  if (!payload) return null;
  const status = text(payload.status) as PublicSourceDiscoveryResponse["status"];
  if (!status || !["disabled", "completed", "unavailable"].includes(status)) {
    return null;
  }
  const provider = nullableText(payload.provider) as PublicDiscoveryProvider | null;
  if (provider && !PUBLIC_DISCOVERY_PROVIDERS.has(provider)) return null;
  const sources = Array.isArray(payload.sources)
    ? payload.sources.map(parsePublicSource).filter((item) => item !== null)
    : [];
  return { status, provider, sources };
}

function parseImport(value: unknown): IntegrationImport | null {
  const item = record(value);
  if (!item) return null;
  const id = text(item.id);
  const syncName = text(item.syncName);
  const model = text(item.model);
  const status = text(item.status) as ImportStatus | null;
  const recordsProcessed = nonNegativeInteger(item.recordsProcessed);
  const pagesProcessed = nonNegativeInteger(item.pagesProcessed);
  const attempts = nonNegativeInteger(item.attempts);
  const queuedAt = text(item.queuedAt);
  if (
    !id ||
    !syncName ||
    !model ||
    !status ||
    !IMPORT_STATUSES.has(status) ||
    recordsProcessed === null ||
    pagesProcessed === null ||
    attempts === null ||
    !queuedAt
  ) {
    return null;
  }
  return {
    id,
    syncName,
    model,
    status,
    recordsProcessed,
    pagesProcessed,
    attempts,
    queuedAt,
    startedAt: nullableText(item.startedAt),
    completedAt: nullableText(item.completedAt),
    nextAttemptAt: nullableText(item.nextAttemptAt),
    lastErrorCode: nullableText(item.lastErrorCode),
  };
}

export function parseIntegrationSyncStatusResponse(
  value: unknown,
): IntegrationSyncStatusResponse | null {
  const payload = record(value);
  if (!payload) return null;
  const integrationId = text(payload.integrationId);
  const connectionState = nullableText(payload.connectionState) as
    | IntegrationSyncStatusResponse["connectionState"];
  if (
    !integrationId ||
    (connectionState !== null &&
      !["Connected", "Needs reconnect", "Disconnected"].includes(
        connectionState,
      ))
  ) {
    return null;
  }
  if (payload.sync !== null && payload.sync !== undefined) {
    const sync = parseImport(payload.sync);
    if (!sync) return null;
    return { integrationId, connectionState, sync };
  }
  return { integrationId, connectionState, sync: null };
}

async function json(response: Response): Promise<unknown> {
  return response.json().catch(() => null);
}

export async function discoverPublicFeedbackSources(input: {
  orgId: string;
  productProfile: ProductProfile;
}): Promise<PublicSourceDiscoveryResponse> {
  const response = await fetch("/api/onboarding/public-sources", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-org-id": input.orgId,
      "idempotency-key": crypto.randomUUID(),
      "x-request-id": crypto.randomUUID(),
    },
    body: JSON.stringify({
      productName: input.productProfile.productName,
      productUrl: normalizeProductUrl(input.productProfile.productUrl),
      productDescription: input.productProfile.productDescription,
    }),
  });
  const payload = parsePublicSourceDiscoveryResponse(await json(response));
  if (!response.ok || !payload) throw new Error("public_discovery_unavailable");
  return payload;
}

export async function fetchIntegrationSyncStatus(input: {
  orgId: string;
  integrationId: string;
}): Promise<IntegrationSyncStatusResponse> {
  const response = await fetch(
    "/api/integrations/pipedream/status",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-org-id": input.orgId,
        "idempotency-key": crypto.randomUUID(),
        "x-request-id": crypto.randomUUID(),
      },
      body: JSON.stringify({ integrationId: input.integrationId }),
      cache: "no-store",
    },
  );
  const payload = record(await json(response));
  const connectionState = payload && ["Connected", "Needs reconnect", "Disconnected"].includes(String(payload.connectionState))
    ? payload.connectionState as IntegrationConnectionState
    : null;
  if (!response.ok || !payload || text(payload.integrationId) !== input.integrationId) {
    throw new Error("sync_status_unavailable");
  }
  return { integrationId: input.integrationId, connectionState, sync: null };
}
