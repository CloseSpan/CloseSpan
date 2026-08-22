import { createHash } from "node:crypto";
import type {
  AiFeedbackInput,
  AiProblemCandidate,
} from "./ai-provider";
import { redactUntrustedText } from "./redaction";

const PROBLEM_MARKER = "CLOSESPAN_PROBLEM_ID";
const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_MATCHES = 5;

export interface CogneeMemoryMatch {
  problemId: string;
  rank: number;
  excerpt: string;
}

export interface CogneeFeedbackMemory {
  feedbackId: string;
  matches: CogneeMemoryMatch[];
}

export interface CogneeMemoryResult {
  status: "used" | "not_configured" | "unavailable" | "no_matches";
  datasetName: string | null;
  feedback: CogneeFeedbackMemory[];
}

interface CogneeConfiguration {
  baseUrl: string;
  apiKey: string;
  timeoutMs: number;
}

const synchronizedSnapshots = new Map<string, Promise<void>>();

function boundedTimeout(value: string | undefined): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_TIMEOUT_MS;
  return Math.max(1_000, Math.min(60_000, Math.floor(parsed)));
}

function configuration(): CogneeConfiguration | null {
  const configuredBaseUrl = process.env.COGNEE_BASE_URL?.trim();
  const apiKey = process.env.COGNEE_API_KEY?.trim();
  if (!configuredBaseUrl || !apiKey) return null;

  const markdownUrl = configuredBaseUrl.match(/^\[[^\]]*\]\((https?:\/\/[^)]+)\)$/i);
  const rawBaseUrl = markdownUrl?.[1] ?? configuredBaseUrl.replace(/^<(https?:\/\/[^>]+)>$/i, "$1");

  let url: URL;
  try {
    url = new URL(rawBaseUrl);
  } catch {
    return null;
  }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password)
    return null;

  return {
    baseUrl: url.toString().replace(/\/$/, ""),
    apiKey,
    timeoutMs: boundedTimeout(process.env.COGNEE_TIMEOUT_MS),
  };
}

function datasetName(orgId: string): string {
  const workspaceHash = createHash("sha256").update(orgId).digest("hex").slice(0, 20);
  return `closespan_${workspaceHash}_problem_memory`;
}

function snapshotHash(candidates: AiProblemCandidate[]): string {
  return createHash("sha256")
    .update(JSON.stringify(candidates.map((candidate) => [
      candidate.id,
      candidate.title,
      candidate.statement,
      candidate.productArea,
      candidate.severity,
    ])))
    .digest("hex")
    .slice(0, 24);
}

function serviceRoot(baseUrl: string): string {
  return baseUrl.endsWith("/api/v1")
    ? baseUrl.slice(0, -"/api/v1".length)
    : baseUrl;
}

function endpoint(baseUrl: string, path: string): string {
  return `${serviceRoot(baseUrl)}/api/v1${path}`;
}

async function authenticatedFetch(
  config: CogneeConfiguration,
  url: string,
  init: RequestInit,
): Promise<Response> {
  const signal = AbortSignal.timeout(config.timeoutMs);
  return fetch(url, {
    ...init,
    signal,
    headers: {
      "X-Api-Key": config.apiKey,
      ...init.headers,
    },
  });
}

async function cogneeFetch(
  config: CogneeConfiguration,
  path: string,
  init: RequestInit,
): Promise<Response> {
  return authenticatedFetch(config, endpoint(config.baseUrl, path), init);
}

function candidateDocument(candidate: AiProblemCandidate): string {
  return [
    `${PROBLEM_MARKER}:${candidate.id}`,
    `Title: ${redactUntrustedText(candidate.title)}`,
    `Statement: ${redactUntrustedText(candidate.statement)}`,
    `Product area: ${redactUntrustedText(candidate.productArea)}`,
    `Severity: ${redactUntrustedText(candidate.severity)}`,
  ].join("\n");
}

async function synchronizeCandidates(
  config: CogneeConfiguration,
  orgId: string,
  candidates: AiProblemCandidate[],
): Promise<void> {
  if (candidates.length === 0) return;
  const dataset = datasetName(orgId);
  const hash = snapshotHash(candidates);
  const cacheKey = `${dataset}:${hash}`;
  const existing = synchronizedSnapshots.get(cacheKey);
  if (existing) return existing;

  const synchronization = (async () => {
    const form = new FormData();
    for (const candidate of candidates) {
      form.append(
        "data",
        new Blob([candidateDocument(candidate)], { type: "text/plain" }),
        `${candidate.id}.txt`,
      );
    }
    form.append("datasetName", dataset);
    form.append("node_set", "closespan_product_problem");
    form.append("run_in_background", "false");

    const response = await cogneeFetch(config, "/remember", {
      method: "POST",
      body: form,
    });
    if (!response.ok)
      throw new Error(`Cognee remember request failed with HTTP ${response.status}`);
  })();

  synchronizedSnapshots.set(cacheKey, synchronization);
  try {
    await synchronization;
  } catch (error) {
    synchronizedSnapshots.delete(cacheKey);
    throw error;
  }
}

function flattenSearchResult(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(flattenSearchResult).join("\n");
  if (value && typeof value === "object")
    return Object.values(value).map(flattenSearchResult).join("\n");
  return "";
}

export function parseCogneeMatches(
  value: unknown,
  candidateIds: string[],
): CogneeMemoryMatch[] {
  const rows = Array.isArray(value) ? value : [];
  const allowed = new Set(candidateIds);
  const matches: CogneeMemoryMatch[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    const searchResult = row && typeof row === "object" && "search_result" in row
      ? (row as { search_result: unknown }).search_result
      : row;
    const text = flattenSearchResult(searchResult);
    const markers = text.matchAll(/CLOSESPAN_PROBLEM_ID:([A-Za-z0-9_-]{1,128})/g);
    for (const marker of markers) {
      const problemId = marker[1];
      if (!allowed.has(problemId) || seen.has(problemId)) continue;
      seen.add(problemId);
      matches.push({
        problemId,
        rank: matches.length + 1,
        excerpt: redactUntrustedText(text).slice(0, 500),
      });
      if (matches.length === MAX_MATCHES) return matches;
    }
  }
  return matches;
}

async function searchFeedback(
  config: CogneeConfiguration,
  orgId: string,
  item: AiFeedbackInput,
  candidates: AiProblemCandidate[],
): Promise<CogneeFeedbackMemory> {
  const response = await cogneeFetch(config, "/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      search_type: "CHUNKS",
      datasets: [datasetName(orgId)],
      query: redactUntrustedText(item.quote),
      top_k: MAX_MATCHES,
      only_context: true,
      verbose: false,
    }),
  });
  if (!response.ok)
    throw new Error(`Cognee search request failed with HTTP ${response.status}`);
  const payload: unknown = await response.json();
  return {
    feedbackId: item.id,
    matches: parseCogneeMatches(payload, candidates.map((candidate) => candidate.id)),
  };
}

export async function retrieveCogneeProblemMemory(input: {
  orgId: string;
  feedback: AiFeedbackInput[];
  candidates: AiProblemCandidate[];
}): Promise<CogneeMemoryResult> {
  const config = configuration();
  if (!config)
    return { status: "not_configured", datasetName: null, feedback: [] };
  if (input.candidates.length === 0)
    return { status: "no_matches", datasetName: datasetName(input.orgId), feedback: [] };

  try {
    await synchronizeCandidates(config, input.orgId, input.candidates);
    const feedback = await Promise.all(
      input.feedback.map((item) => searchFeedback(config, input.orgId, item, input.candidates)),
    );
    return {
      status: feedback.some((item) => item.matches.length > 0) ? "used" : "no_matches",
      datasetName: datasetName(input.orgId),
      feedback,
    };
  } catch {
    return {
      status: "unavailable",
      datasetName: datasetName(input.orgId),
      feedback: [],
    };
  }
}

export async function checkCogneeConnection(): Promise<{
  configured: boolean;
  healthy: boolean;
  status: number | null;
}> {
  const config = configuration();
  if (!config) return { configured: false, healthy: false, status: null };
  try {
    const response = await authenticatedFetch(
      config,
      `${serviceRoot(config.baseUrl)}/health`,
      { method: "GET" },
    );
    return { configured: true, healthy: response.ok, status: response.status };
  } catch {
    return { configured: true, healthy: false, status: null };
  }
}

export function resetCogneeMemoryCacheForTest(): void {
  synchronizedSnapshots.clear();
}
