export type BillingPropertyValue = string | number | boolean | null;

export interface BillingCustomerInput {
  externalCustomerId: string;
  name: string;
  email?: string | null;
  metadata?: Record<string, BillingPropertyValue>;
}

export interface BillingUsageEvent {
  eventId: string;
  eventName: string;
  externalCustomerId: string;
  source: string;
  properties: Record<string, BillingPropertyValue>;
  occurredAt: string;
}

export interface BillingProviderResult {
  providerId: string | null;
}

export interface BillingProvider {
  readonly name: "flexprice";
  provisionCustomer(input: BillingCustomerInput): Promise<BillingProviderResult>;
  publishUsage(input: BillingUsageEvent): Promise<BillingProviderResult>;
}

export class BillingProviderError extends Error {
  readonly retryable: boolean;
  readonly status: number | null;
  readonly code: string | null;
  readonly retryAfterMs: number | null;

  constructor(
    message: string,
    options: {
      retryable: boolean;
      status?: number | null;
      code?: string | null;
      retryAfterMs?: number | null;
      cause?: unknown;
    },
  ) {
    super(message, { cause: options.cause });
    this.name = "BillingProviderError";
    this.retryable = options.retryable;
    this.status = options.status ?? null;
    this.code = options.code ?? null;
    this.retryAfterMs = options.retryAfterMs ?? null;
  }
}

export interface FlexpriceShadowConfiguration {
  enabled: boolean;
  configured: boolean;
  baseUrl: string;
  reason: string | null;
}

const DEFAULT_FLEXPRICE_BASE_URL = "https://us.api.flexprice.io/v1";

function normalizedBaseUrl(value: string | undefined): string | null {
  try {
    const url = new URL(value?.trim() || DEFAULT_FLEXPRICE_BASE_URL);
    if (url.username || url.password || url.search || url.hash) return null;
    if (
      url.protocol !== "https:" &&
      !(process.env.NODE_ENV !== "production" && url.protocol === "http:")
    ) return null;
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

export function flexpriceShadowConfiguration(): FlexpriceShadowConfiguration {
  const enabled = process.env.FLEXPRICE_SHADOW_ENABLED === "true";
  const apiKey = process.env.FLEXPRICE_API_KEY?.trim();
  const baseUrl = normalizedBaseUrl(process.env.FLEXPRICE_API_BASE_URL);
  if (!enabled) {
    return {
      enabled: false,
      configured: false,
      baseUrl: baseUrl ?? DEFAULT_FLEXPRICE_BASE_URL,
      reason: "Shadow delivery is disabled",
    };
  }
  if (!apiKey) {
    return {
      enabled: true,
      configured: false,
      baseUrl: baseUrl ?? DEFAULT_FLEXPRICE_BASE_URL,
      reason: "FLEXPRICE_API_KEY is missing",
    };
  }
  if (!baseUrl) {
    return {
      enabled: true,
      configured: false,
      baseUrl: DEFAULT_FLEXPRICE_BASE_URL,
      reason: "FLEXPRICE_API_BASE_URL is invalid",
    };
  }
  return { enabled: true, configured: true, baseUrl, reason: null };
}

function responseProviderId(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;
  const nested = record.data && typeof record.data === "object"
    ? record.data as Record<string, unknown>
    : null;
  const value = record.id ?? record.event_id ?? nested?.id ?? nested?.event_id;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function responseMetadata(payload: unknown): Record<string, string> {
  if (!payload || typeof payload !== "object") return {};
  const record = payload as Record<string, unknown>;
  const nested = record.data && typeof record.data === "object"
    ? record.data as Record<string, unknown>
    : null;
  const value = record.metadata ?? nested?.metadata;
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}

function responseErrorCode(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;
  const nested = record.error && typeof record.error === "object"
    ? record.error as Record<string, unknown>
    : null;
  const value = record.code ?? record.error_code ?? nested?.code;
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return normalized && normalized.length <= 100 && /^[a-z0-9_.-]+$/.test(normalized)
    ? normalized
    : null;
}

function retryAfterMs(headers: Headers): number | null {
  const value = headers.get("retry-after")?.trim();
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0)
    return Math.min(Math.ceil(seconds * 1_000), 86_400_000);
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return null;
  return Math.min(Math.max(timestamp - Date.now(), 0), 86_400_000);
}

function retryableStatus(status: number): boolean {
  return (
    status === 408 ||
    status === 409 ||
    status === 425 ||
    status === 429 ||
    status >= 500
  );
}

export class FlexpriceBillingProvider implements BillingProvider {
  readonly name = "flexprice" as const;

  constructor(
    private readonly configuration: {
      apiKey: string;
      baseUrl: string;
      timeoutMs: number;
    },
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  private async fetchResponse(
    method: "GET" | "POST" | "PUT",
    path: string,
    body?: Record<string, unknown>,
  ): Promise<Response> {
    try {
      return await this.fetcher(`${this.configuration.baseUrl}${path}`, {
        method,
        headers: {
          "Content-Type": "application/json",
          "x-api-key": this.configuration.apiKey,
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(this.configuration.timeoutMs),
      });
    } catch (error) {
      throw new BillingProviderError("Flexprice request failed", {
        retryable: true,
        cause: error,
      });
    }
  }

  private async responseError(
    response: Response,
    unexpectedSuccess = false,
  ): Promise<BillingProviderError> {
    const payload = await response.json().catch(() => null);
    return new BillingProviderError(
      unexpectedSuccess
        ? `Flexprice returned unexpected HTTP ${response.status}`
        : `Flexprice returned HTTP ${response.status}`,
      {
        retryable: unexpectedSuccess || retryableStatus(response.status),
        status: response.status,
        code: responseErrorCode(payload),
        retryAfterMs: response.status === 429
          ? retryAfterMs(response.headers)
          : null,
      },
    );
  }

  private async payload(
    response: Response,
    expectedStatus: number,
  ): Promise<unknown> {
    if (response.status !== expectedStatus)
      throw await this.responseError(response, response.ok);
    return response.json().catch(() => null);
  }

  private async result(
    response: Response,
    expectedStatus: number,
  ): Promise<BillingProviderResult> {
    return { providerId: responseProviderId(await this.payload(response, expectedStatus)) };
  }

  private customerBody(
    input: BillingCustomerInput,
    existingMetadata?: Record<string, string>,
    includeEmptyMetadata = false,
  ): Record<string, unknown> {
    const body: Record<string, unknown> = {
      external_id: input.externalCustomerId,
      name: input.name,
      ...(input.email ? { email: input.email } : {}),
      ...(includeEmptyMetadata ? { skip_onboarding_workflow: true } : {}),
    };
    if (input.metadata !== undefined || includeEmptyMetadata) {
      body.metadata = {
        ...(input.metadata === undefined ? {} : existingMetadata),
        ...Object.fromEntries(
        Object.entries(input.metadata ?? {}).map(([key, value]) => [
          key,
          value === null ? "" : String(value),
        ]),
        ),
      };
    }
    return body;
  }

  private async findCustomer(
    externalCustomerId: string,
  ): Promise<(BillingProviderResult & { metadata: Record<string, string> }) | null> {
    const response = await this.fetchResponse(
      "GET",
      `/customers/external/${encodeURIComponent(externalCustomerId)}`,
    );
    if (response.status === 404) {
      await response.body?.cancel();
      return null;
    }
    const payload = await this.payload(response, 200);
    return {
      providerId: responseProviderId(payload),
      metadata: responseMetadata(payload),
    };
  }

  private async updateCustomer(
    input: BillingCustomerInput,
    existingMetadata: Record<string, string>,
  ): Promise<BillingProviderResult> {
    const selector = encodeURIComponent(input.externalCustomerId);
    return this.result(
      await this.fetchResponse(
        "PUT",
        `/customers?external_customer_id=${selector}`,
        this.customerBody(input, existingMetadata),
      ),
      200,
    );
  }

  async provisionCustomer(
    input: BillingCustomerInput,
  ): Promise<BillingProviderResult> {
    const existing = await this.findCustomer(input.externalCustomerId);
    if (existing) return this.updateCustomer(input, existing.metadata);

    const response = await this.fetchResponse(
      "POST",
      "/customers",
      this.customerBody(input, undefined, true),
    );
    if (response.status === 201) return this.result(response, 201);
    const createError = await this.responseError(response, response.ok);
    const duplicate = response.status === 409 || createError.code === "already_exists";
    if (!duplicate) throw createError;

    // A timed-out create or a concurrent worker may have created the same
    // external ID. Converge by looking it up before deciding the response is a
    // retryable visibility race.
    const raced = await this.findCustomer(input.externalCustomerId);
    if (raced) return this.updateCustomer(input, raced.metadata);
    throw new BillingProviderError(
      `Flexprice returned HTTP ${response.status}`,
      {
        retryable: true,
        status: response.status,
        code: createError.code,
        retryAfterMs: createError.retryAfterMs,
      },
    );
  }

  async publishUsage(
    input: BillingUsageEvent,
  ): Promise<BillingProviderResult> {
    if (!input.eventId.trim())
      throw new BillingProviderError("Billing event ID is required", {
        retryable: false,
      });
    return this.result(
      await this.fetchResponse("POST", "/events", {
        event_id: input.eventId,
        event_name: input.eventName,
        external_customer_id: input.externalCustomerId,
        source: input.source,
        properties: input.properties,
        timestamp: input.occurredAt,
      }),
      202,
    );
  }
}

export function createFlexpriceBillingProvider(
  fetcher: typeof fetch = fetch,
): BillingProvider | null {
  const status = flexpriceShadowConfiguration();
  const apiKey = process.env.FLEXPRICE_API_KEY?.trim();
  if (!status.configured || !apiKey) return null;
  const requestedTimeout = Number(process.env.FLEXPRICE_TIMEOUT_MS ?? 10_000);
  const timeoutMs = Number.isFinite(requestedTimeout)
    ? Math.min(Math.max(requestedTimeout, 1_000), 30_000)
    : 10_000;
  return new FlexpriceBillingProvider(
    { apiKey, baseUrl: status.baseUrl, timeoutMs },
    fetcher,
  );
}
