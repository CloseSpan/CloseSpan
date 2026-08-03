import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";

const MAX_HTML_BYTES = 512_000;
const MAX_LOGO_BYTES = 160_000;
const MAX_REDIRECTS = 3;
const FETCH_TIMEOUT_MS = 8_000;

type Fetch = typeof fetch;
type Lookup = (hostname: string) => Promise<Array<{ address: string }>>;

export interface DiscoveredCompanyProfile {
  name: string;
  url: string;
  description: string | null;
  logo: string | null;
}

export interface CompanyProfileDiscoveryDependencies {
  fetch?: Fetch;
  lookup?: Lookup;
}

function normalizeCandidate(value: string): URL | null {
  const trimmed = value.trim().replace(/[),.;!?]+$/, "");
  if (!trimmed) return null;
  const candidate = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  try {
    const url = new URL(candidate);
    if (
      !["http:", "https:"].includes(url.protocol)
      || url.username
      || url.password
      || !url.hostname.includes(".")
    ) return null;
    url.hash = "";
    return url;
  } catch {
    return null;
  }
}

export function extractCompanyUrl(message: string): string | null {
  const candidates = message.match(
    /(?:https?:\/\/|www\.)[^\s<>]+|(?:[a-z0-9](?:[a-z0-9-]{0,62})\.)+[a-z]{2,}(?:\/[^\s<>]*)?/gi,
  ) ?? [];
  for (const candidate of candidates) {
    const normalized = normalizeCandidate(candidate);
    if (normalized) return normalized.toString();
  }
  return null;
}

function isPrivateIp(address: string): boolean {
  const normalized = address.toLowerCase();
  if (normalized === "::" || normalized === "::1") return true;
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true;
  if (/^fe[89ab]/.test(normalized)) return true;
  const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  const value = mapped ?? normalized;
  if (isIP(value) !== 4) return false;
  const octets = value.split(".").map(Number);
  const [a, b] = octets;
  return (
    a === 0
    || a === 10
    || a === 127
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || (a === 198 && (b === 18 || b === 19))
    || a >= 224
  );
}

async function assertPublicUrl(url: URL, lookup: Lookup): Promise<void> {
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (
    !host
    || host === "localhost"
    || host.endsWith(".localhost")
    || host.endsWith(".local")
    || host.endsWith(".internal")
  ) throw new Error("Company URL must be publicly reachable");
  if (isIP(host)) {
    if (isPrivateIp(host)) throw new Error("Company URL must be publicly reachable");
    return;
  }
  const addresses = await lookup(host);
  if (!addresses.length || addresses.some(({ address }) => isPrivateIp(address))) {
    throw new Error("Company URL must be publicly reachable");
  }
}

async function defaultLookup(hostname: string): Promise<Array<{ address: string }>> {
  return dnsLookup(hostname, { all: true, verbatim: true });
}

async function readBounded(response: Response, maximum: number): Promise<Uint8Array> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maximum) {
    throw new Error("Company page response is too large");
  }
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maximum) {
      await reader.cancel();
      throw new Error("Company page response is too large");
    }
    chunks.push(value);
  }
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

async function fetchPublic(
  initialUrl: URL,
  fetcher: Fetch,
  lookup: Lookup,
  accept: string,
): Promise<{ response: Response; url: URL }> {
  let current = initialUrl;
  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
    await assertPublicUrl(current, lookup);
    const response = await fetcher(current, {
      redirect: "manual",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: {
        Accept: accept,
        "User-Agent": "CloseSpanCompanyProfile/1.0",
      },
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location || redirect === MAX_REDIRECTS) {
        throw new Error("Company URL redirected too many times");
      }
      current = new URL(location, current);
      continue;
    }
    if (!response.ok) throw new Error("Company page could not be loaded");
    return { response, url: current };
  }
  throw new Error("Company URL redirected too many times");
}

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCodePoint(Number(code)))
    .replace(/\s+/g, " ")
    .trim();
}

function attributes(tag: string): Map<string, string> {
  const result = new Map<string, string>();
  const pattern = /([:\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
  for (const match of tag.matchAll(pattern)) {
    result.set(match[1]!.toLowerCase(), decodeHtml(match[2] ?? match[3] ?? match[4] ?? ""));
  }
  return result;
}

function metadata(html: string): {
  title: string | null;
  description: string | null;
  logoUrl: string | null;
} {
  const meta = new Map<string, string>();
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const attrs = attributes(tag);
    const key = (attrs.get("property") ?? attrs.get("name") ?? "").toLowerCase();
    const content = attrs.get("content");
    if (key && content && !meta.has(key)) meta.set(key, content);
  }
  let logoUrl = meta.get("og:logo") ?? meta.get("logo") ?? null;
  if (!logoUrl) {
    for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
      const attrs = attributes(tag);
      const rel = attrs.get("rel")?.toLowerCase() ?? "";
      if (/\b(?:icon|apple-touch-icon)\b/.test(rel) && attrs.get("href")) {
        logoUrl = attrs.get("href")!;
        if (rel.includes("apple-touch-icon")) break;
      }
    }
  }
  const titleTag = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  return {
    title: meta.get("og:site_name")
      ?? meta.get("application-name")
      ?? meta.get("og:title")
      ?? (titleTag ? decodeHtml(titleTag.replace(/<[^>]+>/g, "")) : null),
    description: meta.get("og:description") ?? meta.get("description") ?? null,
    logoUrl,
  };
}

function fallbackName(url: URL): string {
  const label = url.hostname.replace(/^www\./, "").split(".")[0] ?? "Company";
  return label
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ") || "Company";
}

function cleanName(value: string | null, url: URL): string {
  const candidate = value?.split(/\s+[|–—-]\s+/)[0]?.trim();
  return (candidate || fallbackName(url)).slice(0, 120);
}

async function fetchLogoDataUrl(
  value: string | null,
  pageUrl: URL,
  fetcher: Fetch,
  lookup: Lookup,
): Promise<string | null> {
  const candidates = value ? [value] : ["/favicon.ico"];
  for (const candidate of candidates) {
    try {
      const url = new URL(candidate, pageUrl);
      const { response } = await fetchPublic(url, fetcher, lookup, "image/png,image/jpeg,image/webp,image/x-icon");
      const contentType = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() ?? "";
      if (!new Set(["image/png", "image/jpeg", "image/webp", "image/gif", "image/x-icon", "image/vnd.microsoft.icon"]).has(contentType)) {
        continue;
      }
      const bytes = await readBounded(response, MAX_LOGO_BYTES);
      if (!bytes.byteLength) continue;
      return `data:${contentType};base64,${Buffer.from(bytes).toString("base64")}`;
    } catch {
      // A logo is optional; page identity can still be confirmed without it.
    }
  }
  return null;
}

export async function discoverCompanyProfile(
  value: string,
  dependencies: CompanyProfileDiscoveryDependencies = {},
): Promise<DiscoveredCompanyProfile> {
  const initialUrl = normalizeCandidate(value);
  if (!initialUrl) throw new Error("Enter a valid public company URL");
  const fetcher = dependencies.fetch ?? fetch;
  const lookup = dependencies.lookup ?? defaultLookup;
  const { response, url } = await fetchPublic(initialUrl, fetcher, lookup, "text/html,application/xhtml+xml");
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.includes("text/html") && !contentType.includes("application/xhtml+xml")) {
    throw new Error("Company URL must point to a website");
  }
  const html = new TextDecoder().decode(await readBounded(response, MAX_HTML_BYTES));
  const found = metadata(html);
  const logo = await fetchLogoDataUrl(found.logoUrl, url, fetcher, lookup);
  return {
    name: cleanName(found.title, url),
    url: url.toString(),
    description: found.description?.slice(0, 800) || null,
    logo,
  };
}
