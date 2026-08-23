import { createHmac, randomUUID } from "node:crypto";

export class N8nConfigurationError extends Error {}
export class N8nConnectionError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
  }
}

export interface N8nTriggerResult {
  accepted: true;
  deliveryId: string;
  executionId: string | null;
  runUrl: string | null;
  message: string;
}

function signedHeaders(payload: string, signingSecret: string): Record<string, string> {
  const signature = createHmac("sha256", signingSecret)
    .update(payload, "utf8")
    .digest("hex");
  return {
    Accept: "application/json",
    "Content-Type": "application/json",
    "x-closespan-signature": `sha256=${signature}`,
  };
}

function normalizeUrl(value: string, label: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    throw new N8nConfigurationError(`${label} must be a valid URL`);
  }
  const loopback = new Set(["localhost", "127.0.0.1", "::1"]);
  const insecureLocal =
    process.env.NODE_ENV !== "production" &&
    parsed.protocol === "http:" &&
    loopback.has(parsed.hostname);
  if (parsed.protocol !== "https:" && !insecureLocal) {
    throw new N8nConfigurationError(
      `${label} must use HTTPS${process.env.NODE_ENV === "production" ? "" : " unless it is a local development URL"}`,
    );
  }
  if (parsed.username || parsed.password || parsed.hash) {
    throw new N8nConfigurationError(
      `${label} cannot contain credentials or a URL fragment`,
    );
  }
  return parsed;
}

export function normalizeN8nConfiguration(input: {
  baseUrl: string;
  triggerUrl: string;
}): { baseUrl: string; triggerUrl: string } {
  const base = normalizeUrl(input.baseUrl, "n8n base URL");
  const trigger = normalizeUrl(input.triggerUrl, "n8n production webhook URL");
  if (base.origin !== trigger.origin) {
    throw new N8nConfigurationError(
      "The n8n production webhook must use the same origin as the n8n instance so credentials cannot be routed to another host",
    );
  }
  if (!base.pathname.endsWith("/")) base.pathname += "/";
  return {
    baseUrl: base.toString().replace(/\/$/, ""),
    triggerUrl: trigger.toString(),
  };
}

async function responseMessage(response: Response): Promise<string> {
  const fallback = `n8n returned HTTP ${response.status}`;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    const text = (await response.text()).trim();
    return text.slice(0, 240) || fallback;
  }
  const body = (await response.json().catch(() => null)) as
    | { message?: unknown; error?: unknown }
    | null;
  const candidate = body?.message ?? body?.error;
  return typeof candidate === "string" && candidate.trim()
    ? candidate.trim().slice(0, 240)
    : fallback;
}

export async function testN8nConnection(input: {
  baseUrl: string;
  apiKey: string;
  fetchImpl?: typeof fetch;
}): Promise<void> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const base = normalizeUrl(input.baseUrl, "n8n base URL");
  if (!base.pathname.endsWith("/")) base.pathname += "/";
  const endpoint = new URL("api/v1/workflows?limit=1", base);
  let response: Response;
  try {
    response = await fetchImpl(endpoint, {
      method: "GET",
      redirect: "error",
      headers: {
        Accept: "application/json",
        "X-N8N-API-KEY": input.apiKey,
      },
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    throw new N8nConnectionError(
      error instanceof Error && error.name === "TimeoutError"
        ? "The n8n connection test timed out"
        : "CloseSpan could not reach the configured n8n instance",
      "n8n_unreachable",
    );
  }
  if (!response.ok) {
    throw new N8nConnectionError(
      `n8n connection test failed: ${await responseMessage(response)}`,
      response.status === 401 || response.status === 403
        ? "n8n_authentication_failed"
        : `n8n_http_${response.status}`,
    );
  }
}

export async function testN8nWorkflowEndpoint(input: {
  baseUrl: string;
  triggerUrl: string;
  signingSecret: string;
  fetchImpl?: typeof fetch;
}): Promise<void> {
  const normalized = normalizeN8nConfiguration(input);
  const deliveryId = `n8n_test_${randomUUID()}`;
  const payload = JSON.stringify({
    event: "connection.test",
    version: "2026-08-22",
    deliveryId,
    dryRun: true,
    sentAt: new Date().toISOString(),
  });
  let response: Response;
  try {
    response = await (input.fetchImpl ?? fetch)(normalized.triggerUrl, {
      method: "POST",
      redirect: "error",
      headers: {
        ...signedHeaders(payload, input.signingSecret),
        "x-closespan-delivery-id": deliveryId,
      },
      body: payload,
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    throw new N8nConnectionError(
      error instanceof Error && error.name === "TimeoutError"
        ? "The n8n production webhook connection test timed out"
        : "CloseSpan could not reach the configured n8n production webhook",
      "n8n_webhook_unreachable",
    );
  }
  if (!response.ok) {
    throw new N8nConnectionError(
      `n8n production webhook test failed: ${await responseMessage(response)}`,
      `n8n_webhook_http_${response.status}`,
    );
  }
}

export async function triggerN8nFeedbackPull(input: {
  baseUrl: string;
  triggerUrl: string;
  signingSecret: string;
  orgId: string;
  actorId: string;
  actorName: string;
  traceId: string;
  integrationIds?: readonly string[];
  accountIds?: readonly string[];
  fetchImpl?: typeof fetch;
}): Promise<N8nTriggerResult> {
  const normalized = normalizeN8nConfiguration(input);
  const deliveryId = `n8n_${randomUUID()}`;
  const payload = JSON.stringify({
    event: "feedback.pull.requested",
    version: "2026-08-22",
    organizationId: input.orgId,
    requestedBy: {
      id: input.actorId,
      name: input.actorName,
    },
    traceId: input.traceId,
    deliveryId,
    selection: input.integrationIds?.length || input.accountIds?.length
      ? {
          mode: "selected",
          integrationIds: [...(input.integrationIds ?? [])],
          accountIds: [...(input.accountIds ?? [])],
        }
      : { mode: "all", integrationIds: [], accountIds: [] },
    resultContract: {
      behavior:
        "Import and normalize feedback through the CloseSpan webhook configured in this n8n workflow.",
      idempotency:
        "Use a stable upstream message ID as x-closespan-delivery-id when returning feedback.",
    },
  });
  let response: Response;
  try {
    response = await (input.fetchImpl ?? fetch)(normalized.triggerUrl, {
      method: "POST",
      redirect: "error",
      headers: {
        ...signedHeaders(payload, input.signingSecret),
        "x-closespan-delivery-id": deliveryId,
      },
      body: payload,
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    throw new N8nConnectionError(
      error instanceof Error && error.name === "TimeoutError"
        ? "The n8n workflow did not acknowledge the request in time"
        : "CloseSpan could not trigger the configured n8n workflow",
      "n8n_trigger_unreachable",
    );
  }
  if (!response.ok) {
    throw new N8nConnectionError(
      `n8n workflow trigger failed: ${await responseMessage(response)}`,
      `n8n_trigger_http_${response.status}`,
    );
  }
  const body = (await response.json().catch(() => null)) as
    | { executionId?: unknown; runUrl?: unknown; message?: unknown }
    | null;
  return {
    accepted: true,
    deliveryId,
    executionId:
      typeof body?.executionId === "string" ? body.executionId : null,
    runUrl: typeof body?.runUrl === "string" ? body.runUrl : null,
    message:
      typeof body?.message === "string" && body.message.trim()
        ? body.message.trim().slice(0, 300)
        : "n8n accepted the feedback collection request.",
  };
}
