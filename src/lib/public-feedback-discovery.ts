import { createHash } from "node:crypto";
import { isIP } from "node:net";
import { z } from "zod";

export const publicFeedbackSourceKindSchema = z.enum([
  "app_store",
  "play_store",
  "review_site",
  "community",
  "social",
  "other",
]);

export const publicFeedbackDiscoveryProviderSchema = z.enum([
  "you",
  "bright_data",
]);

const nullableTrimmedText = (maximum: number) =>
  z.string().trim().min(1).max(maximum).nullable().optional();

const rawPublicFeedbackDiscoveryInputSchema = z
  .object({
    productName: nullableTrimmedText(160),
    productUrl: nullableTrimmedText(2_048),
    productDescription: nullableTrimmedText(1_000),
  })
  .strict();

export const publicFeedbackDiscoveryInputSchema =
  rawPublicFeedbackDiscoveryInputSchema.transform((value, context) => {
    if (value.productUrl) {
      try {
        const url = new URL(value.productUrl);
        if (!isHttpProtocol(url.protocol)) throw new Error("unsupported protocol");
      } catch {
        context.addIssue({
          code: "custom",
          path: ["productUrl"],
          message: "Product URL must be a valid public http(s) URL",
        });
      }
    }
    return {
      productName: value.productName ?? null,
      productUrl: value.productUrl ?? null,
      productDescription: value.productDescription ?? null,
    };
  });

export type PublicFeedbackDiscoveryInput = z.output<
  typeof publicFeedbackDiscoveryInputSchema
>;
export type PublicFeedbackSourceKind = z.infer<
  typeof publicFeedbackSourceKindSchema
>;
export type PublicFeedbackDiscoveryProvider = z.infer<
  typeof publicFeedbackDiscoveryProviderSchema
>;

export interface PublicFeedbackSource {
  id: string;
  title: string;
  url: string;
  host: string;
  kind: PublicFeedbackSourceKind;
  reason: string;
  confidence: "high" | "medium" | "low";
  discoveredBy: PublicFeedbackDiscoveryProvider;
  provenance: {
    provider: PublicFeedbackDiscoveryProvider;
    retrievedAt: string;
  };
}

export interface PublicFeedbackDiscoveryResult {
  status: "disabled" | "completed" | "unavailable";
  provider: PublicFeedbackDiscoveryProvider | null;
  sources: PublicFeedbackSource[];
}

export interface PublicFeedbackDiscoveryAdapter {
  readonly id: PublicFeedbackDiscoveryProvider;
  discover(
    input: PublicFeedbackDiscoveryInput,
  ): Promise<PublicFeedbackSource[]>;
}

export interface PublicFeedbackDiscoveryConfiguration {
  you: {
    enabled: boolean;
    configured: boolean;
  };
  brightData: {
    enabled: boolean;
    configured: boolean;
  };
}

type Environment = Readonly<Record<string, string | undefined>>;
type Fetch = typeof fetch;
type Clock = () => Date;

const MAX_PROVIDER_RESPONSE_BYTES = 1_000_000;
const OFFICIAL_YOU_SEARCH_HOSTS = new Set(["ydc-index.io"]);

interface PublicSearchHit {
  title: string;
  url: string;
  description?: string | null;
  snippets?: string[];
}

const youSearchResponseSchema = z.object({
  results: z.object({
    web: z
      .array(
        z
          .object({
            title: z.string().max(1_000),
            url: z.string().max(4_096),
            description: z.string().max(20_000).nullish(),
            snippets: z.array(z.string().max(20_000)).max(20).optional(),
          })
          .passthrough(),
      )
      .max(100)
      .optional()
      .default([]),
  }),
});

const KNOWN_REVIEW_HOSTS = new Set([
  "g2.com",
  "trustpilot.com",
  "capterra.com",
  "getapp.com",
  "producthunt.com",
  "softwareadvice.com",
]);

const COMMUNITY_HOSTS = new Set([
  "reddit.com",
  "news.ycombinator.com",
  "stackoverflow.com",
]);

const SOCIAL_HOSTS = new Set(["x.com", "twitter.com", "threads.net"]);

const BOOSTED_DISCOVERY_HOSTS = [
  "apps.apple.com",
  "play.google.com",
  ...KNOWN_REVIEW_HOSTS,
  ...COMMUNITY_HOSTS,
  ...SOCIAL_HOSTS,
];

const IDENTITY_STOP_WORDS = new Set([
  "app",
  "application",
  "company",
  "platform",
  "product",
  "software",
  "technology",
  "website",
]);

const TRACKING_PARAMETERS = new Set([
  "fbclid",
  "gclid",
  "mc_cid",
  "mc_eid",
  "ref",
  "source",
]);

function isHttpProtocol(protocol: string): boolean {
  return protocol === "http:" || protocol === "https:";
}

function isExplicitlyEnabled(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === "true";
}

function isProductionEnvironment(environment: Environment): boolean {
  return (
    environment.APP_MODE === "production" ||
    (environment.APP_MODE !== "demo" && environment.NODE_ENV === "production")
  );
}

function positiveInteger(
  value: string | undefined,
  fallback: number,
  maximum: number,
): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, maximum);
}

function isPublicHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (
    !host ||
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    isIP(host) !== 0
  ) {
    return false;
  }
  return host.includes(".");
}

function canonicalPublicUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    if (
      !isHttpProtocol(url.protocol) ||
      url.username ||
      url.password ||
      !isPublicHostname(url.hostname)
    ) {
      return null;
    }
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (key.toLowerCase().startsWith("utm_") || TRACKING_PARAMETERS.has(key.toLowerCase())) {
        url.searchParams.delete(key);
      }
    }
    url.searchParams.sort();
    return url;
  } catch {
    return null;
  }
}

function hostnameWithoutWww(hostname: string): string {
  return hostname.toLowerCase().replace(/^www\./, "");
}

function hostnameFromProductUrl(value: string | null): string | null {
  if (!value) return null;
  const url = canonicalPublicUrl(value);
  return url ? hostnameWithoutWww(url.hostname) : null;
}

function productIdentity(input: PublicFeedbackDiscoveryInput): string | null {
  if (input.productName) return input.productName;
  const host = hostnameFromProductUrl(input.productUrl);
  if (!host) return null;
  const label = host.split(".")[0]?.replace(/[-_]+/g, " ").trim();
  return label || null;
}

function identityTokens(input: PublicFeedbackDiscoveryInput): string[] {
  const identity = productIdentity(input);
  if (!identity) return [];
  return identity
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(
      (token) => token.length >= 3 && !IDENTITY_STOP_WORDS.has(token),
    );
}

export function buildPublicFeedbackSearchQuery(
  input: PublicFeedbackDiscoveryInput,
): string | null {
  const identity = productIdentity(input)?.replace(/["\r\n]+/g, " ").trim();
  if (!identity) return null;
  return `"${identity.slice(0, 160)}" customer reviews feedback ratings app store google play G2 Trustpilot Capterra Reddit community forum`;
}

function classifySource(
  url: URL,
  searchText: string,
  productHost: string | null,
): PublicFeedbackSourceKind | null {
  const host = hostnameWithoutWww(url.hostname);
  const path = url.pathname.toLowerCase();
  if (host === "apps.apple.com" && /\/app(?:\/|$)/.test(path)) {
    return "app_store";
  }
  if (
    host === "play.google.com" &&
    path.startsWith("/store/apps/details") &&
    url.searchParams.has("id")
  ) {
    return "play_store";
  }
  if (KNOWN_REVIEW_HOSTS.has(host)) return "review_site";
  if (
    COMMUNITY_HOSTS.has(host) ||
    /^(community|discuss|forum|forums)\./.test(host) ||
    /\/(community|discuss|forum|forums|issues)(?:\/|$)/.test(path)
  ) {
    return "community";
  }
  if (SOCIAL_HOSTS.has(host)) return "social";
  if (
    productHost &&
    (host === productHost || host.endsWith(`.${productHost}`)) &&
    /\/(feedback|reviews?|ratings?|testimonials?|ideas)(?:\/|$)/.test(path)
  ) {
    return "other";
  }
  return /\b(feedback|reviews?|ratings?|testimonials?|complaints?)\b/.test(
    searchText,
  )
    ? "other"
    : null;
}

function sourceMatchesProduct(
  hit: PublicSearchHit,
  url: URL,
  input: PublicFeedbackDiscoveryInput,
): boolean {
  const productHost = hostnameFromProductUrl(input.productUrl);
  const hitHost = hostnameWithoutWww(url.hostname);
  if (
    productHost &&
    (hitHost === productHost || hitHost.endsWith(`.${productHost}`))
  ) {
    return true;
  }
  const tokens = identityTokens(input);
  if (tokens.length === 0) return false;
  const text = [hit.title, hit.description, ...(hit.snippets ?? []), url.href]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return tokens.some((token) => text.includes(token));
}

function cleanTitle(value: string, host: string): string {
  const title = value.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  return (title || host).slice(0, 240);
}

function confidenceFor(
  kind: PublicFeedbackSourceKind,
  hit: PublicSearchHit,
  input: PublicFeedbackDiscoveryInput,
): PublicFeedbackSource["confidence"] {
  const productName = input.productName?.toLowerCase();
  const nameInTitle = Boolean(
    productName && hit.title.toLowerCase().includes(productName),
  );
  if (
    nameInTitle &&
    ["app_store", "play_store", "review_site"].includes(kind)
  ) {
    return "high";
  }
  return kind === "community" || kind === "social" ? "low" : "medium";
}

function reasonFor(kind: PublicFeedbackSourceKind, identity: string): string {
  const labels: Record<PublicFeedbackSourceKind, string> = {
    app_store: "Apple App Store reviews",
    play_store: "Google Play reviews",
    review_site: "a public review profile",
    community: "a public community discussion source",
    social: "a public social discussion source",
    other: "a public feedback page",
  };
  return `Found ${labels[kind]} that may belong to ${identity}; confirm it before importing feedback.`;
}

function sourceId(url: string): string {
  return `public_${createHash("sha256").update(url).digest("hex").slice(0, 20)}`;
}

function normalizeSearchHits(input: {
  hits: PublicSearchHit[];
  product: PublicFeedbackDiscoveryInput;
  provider: PublicFeedbackDiscoveryProvider;
  retrievedAt: string;
}): PublicFeedbackSource[] {
  const identity = productIdentity(input.product);
  if (!identity) return [];
  const productHost = hostnameFromProductUrl(input.product.productUrl);
  const seen = new Set<string>();
  const sources: PublicFeedbackSource[] = [];
  for (const hit of input.hits) {
    const url = canonicalPublicUrl(hit.url);
    if (!url || !sourceMatchesProduct(hit, url, input.product)) continue;
    const host = hostnameWithoutWww(url.hostname);
    const searchText = [hit.title, hit.description, ...(hit.snippets ?? [])]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    const kind = classifySource(url, searchText, productHost);
    const canonical = url.toString();
    if (!kind || seen.has(canonical)) continue;
    seen.add(canonical);
    sources.push({
      id: sourceId(canonical),
      title: cleanTitle(hit.title, host),
      url: canonical,
      host,
      kind,
      reason: reasonFor(kind, identity),
      confidence: confidenceFor(kind, hit, input.product),
      discoveredBy: input.provider,
      provenance: {
        provider: input.provider,
        retrievedAt: input.retrievedAt,
      },
    });
    if (sources.length >= 12) break;
  }
  return sources;
}

async function jsonWithinLimit(response: Response): Promise<unknown> {
  const contentLength = Number(response.headers.get("content-length"));
  if (
    Number.isFinite(contentLength) &&
    contentLength > MAX_PROVIDER_RESPONSE_BYTES
  ) {
    throw new Error("response too large");
  }
  const body = await response.text();
  if (body.length > MAX_PROVIDER_RESPONSE_BYTES) {
    throw new Error("response too large");
  }
  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw new Error("invalid response");
  }
}

export class YouPublicFeedbackDiscoveryAdapter
  implements PublicFeedbackDiscoveryAdapter
{
  readonly id = "you" as const;
  private readonly endpoint: URL;
  private readonly fetchImpl: Fetch;
  private readonly timeoutMs: number;
  private readonly now: Clock;

  constructor(options: {
    apiKey: string;
    endpoint?: string;
    fetchImpl?: Fetch;
    timeoutMs?: number;
    now?: Clock;
    production?: boolean;
  }) {
    if (!options.apiKey.trim()) throw new Error("You.com API key is required");
    const endpoint = new URL(
      options.endpoint?.trim() || "https://ydc-index.io/v1/search",
    );
    if (endpoint.protocol !== "https:") {
      throw new Error("You.com endpoint must use https");
    }
    if (endpoint.username || endpoint.password) {
      throw new Error("You.com endpoint must not contain credentials");
    }
    const production =
      options.production ?? isProductionEnvironment(process.env);
    if (
      production &&
      !OFFICIAL_YOU_SEARCH_HOSTS.has(endpoint.hostname.toLowerCase())
    ) {
      throw new Error("You.com endpoint must use an official host");
    }
    this.endpoint = endpoint;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 8_000;
    this.now = options.now ?? (() => new Date());
    this.apiKey = options.apiKey.trim();
  }

  private readonly apiKey: string;

  async discover(
    input: PublicFeedbackDiscoveryInput,
  ): Promise<PublicFeedbackSource[]> {
    const query = buildPublicFeedbackSearchQuery(input);
    if (!query) return [];
    const url = new URL(this.endpoint);
    url.searchParams.set("query", query);
    url.searchParams.set("count", "20");
    url.searchParams.set("language", "EN");
    url.searchParams.set("safesearch", "strict");
    url.searchParams.set("boost_domains", BOOSTED_DISCOVERY_HOSTS.join(","));

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: "GET",
        headers: {
          Accept: "application/json",
          "X-API-Key": this.apiKey,
        },
        cache: "no-store",
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
    if (!response.ok) throw new Error("You.com search failed");
    const parsed = youSearchResponseSchema.safeParse(
      await jsonWithinLimit(response),
    );
    if (!parsed.success) throw new Error("You.com returned an invalid response");
    return normalizeSearchHits({
      hits: parsed.data.results.web,
      product: input,
      provider: this.id,
      retrievedAt: this.now().toISOString(),
    });
  }
}

/**
 * Dataset-specific Bright Data plumbing belongs behind this small client.
 * No client is created from environment variables today, so the fallback is
 * inert in production unless it is deliberately wired and enabled.
 */
export interface BrightDataPublicDiscoveryClient {
  discover(input: {
    identity: string;
    publicHostname: string | null;
    query: string;
  }): Promise<PublicSearchHit[]>;
}

export class BrightDataPublicFeedbackDiscoveryAdapter
  implements PublicFeedbackDiscoveryAdapter
{
  readonly id = "bright_data" as const;

  constructor(
    private readonly client: BrightDataPublicDiscoveryClient,
    private readonly now: Clock = () => new Date(),
  ) {}

  async discover(
    input: PublicFeedbackDiscoveryInput,
  ): Promise<PublicFeedbackSource[]> {
    const query = buildPublicFeedbackSearchQuery(input);
    const identity = productIdentity(input);
    if (!query || !identity) return [];
    const hits = await this.client.discover({
      identity,
      publicHostname: hostnameFromProductUrl(input.productUrl),
      query,
    });
    return normalizeSearchHits({
      hits,
      product: input,
      provider: this.id,
      retrievedAt: this.now().toISOString(),
    });
  }
}

export function publicFeedbackDiscoveryConfiguration(
  environment: Environment = process.env,
): PublicFeedbackDiscoveryConfiguration {
  const youKey =
    environment.YOU_API_KEY?.trim() || environment.YDC_API_KEY?.trim() || "";
  return {
    you: {
      enabled: isExplicitlyEnabled(
        environment.YOU_PUBLIC_DISCOVERY_ENABLED,
      ),
      configured: Boolean(youKey),
    },
    brightData: {
      enabled: isExplicitlyEnabled(
        environment.BRIGHT_DATA_PUBLIC_DISCOVERY_ENABLED,
      ),
      // Bright Data requires a dataset-specific client, injected below.
      configured: false,
    },
  };
}

export function createPublicFeedbackDiscoveryAdapters(options: {
  environment?: Environment;
  fetchImpl?: Fetch;
  now?: Clock;
  brightDataAdapter?: PublicFeedbackDiscoveryAdapter;
} = {}): PublicFeedbackDiscoveryAdapter[] {
  const environment = options.environment ?? process.env;
  const configuration = publicFeedbackDiscoveryConfiguration(environment);
  const adapters: PublicFeedbackDiscoveryAdapter[] = [];
  const youKey =
    environment.YOU_API_KEY?.trim() || environment.YDC_API_KEY?.trim() || "";
  if (configuration.you.enabled && configuration.you.configured) {
    adapters.push(
      new YouPublicFeedbackDiscoveryAdapter({
        apiKey: youKey,
        endpoint: environment.YOU_SEARCH_ENDPOINT,
        timeoutMs: positiveInteger(
          environment.YOU_PUBLIC_DISCOVERY_TIMEOUT_MS,
          8_000,
          20_000,
        ),
        fetchImpl: options.fetchImpl,
        now: options.now,
      }),
    );
  }
  if (
    configuration.brightData.enabled &&
    options.brightDataAdapter?.id === "bright_data"
  ) {
    adapters.push(options.brightDataAdapter);
  }
  return adapters;
}

export async function discoverPublicFeedbackSources(
  input: PublicFeedbackDiscoveryInput,
  options: {
    environment?: Environment;
    adapters?: PublicFeedbackDiscoveryAdapter[];
    fetchImpl?: Fetch;
    now?: Clock;
    brightDataAdapter?: PublicFeedbackDiscoveryAdapter;
  } = {},
): Promise<PublicFeedbackDiscoveryResult> {
  const environment = options.environment ?? process.env;
  const configuration = publicFeedbackDiscoveryConfiguration(environment);
  const adapters =
    options.adapters ??
    createPublicFeedbackDiscoveryAdapters({
      environment,
      fetchImpl: options.fetchImpl,
      now: options.now,
      brightDataAdapter: options.brightDataAdapter,
    });
  const anyProviderEnabled =
    options.adapters !== undefined
      ? adapters.length > 0
      : configuration.you.enabled || configuration.brightData.enabled;
  if (adapters.length === 0) {
    return {
      status: anyProviderEnabled ? "unavailable" : "disabled",
      provider: null,
      sources: [],
    };
  }

  let firstSuccessfulProvider: PublicFeedbackDiscoveryProvider | null = null;
  for (const adapter of adapters) {
    try {
      const sources = await adapter.discover(input);
      firstSuccessfulProvider ??= adapter.id;
      if (sources.length > 0) {
        return {
          status: "completed",
          provider: adapter.id,
          sources,
        };
      }
    } catch {
      // Provider errors are intentionally reduced to provenance-only logs. API
      // keys, response bodies, and upstream messages must never reach the UI.
      console.warn(
        `[public-feedback-discovery] ${adapter.id} is unavailable`,
      );
    }
  }

  return firstSuccessfulProvider
    ? { status: "completed", provider: firstSuccessfulProvider, sources: [] }
    : { status: "unavailable", provider: null, sources: [] };
}
