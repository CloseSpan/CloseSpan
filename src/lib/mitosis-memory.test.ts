import { afterEach, describe, expect, it, vi } from "vitest";
import type { FeedbackItem } from "./domain";
import {
  askMitosisMemory,
  checkMitosisPilotStatus,
  normalizeMitosisAnswer,
  sanitizeFeedbackForMitosis,
  syncSanitizedFeedbackToMitosis,
} from "./mitosis-memory";

const ORG_ID = "org_mitosis_test";

function configure(): void {
  process.env.MITOSIS_PILOT_ENABLED = "true";
  process.env.MITOSIS_PILOT_ORG_ID = ORG_ID;
  process.env.MITOSIS_MCP_URL = "https://mitosislabs.ai/api/mcp/o/test-office";
  process.env.MITOSIS_API_KEY = "mitosis_test_bearer_credential";
}

function feedback(overrides: Partial<FeedbackItem> = {}): FeedbackItem {
  return {
    id: "fb_001",
    orgId: ORG_ID,
    source: "Zendesk",
    customer: "Secret Customer Name",
    accountTier: "Enterprise",
    arr: 500_000,
    type: "Bug",
    severity: "High",
    redacted: true,
    environment: "Chrome · password=hunter2",
    confidence: 0.95,
    observedAt: "2026-08-26T10:00:00Z",
    quote: "Export is empty. Contact person@example.com or +1 (415) 555-1212.",
    ...overrides,
  };
}

function successResult(structuredContent: unknown = { ok: true }): Response {
  return new Response(JSON.stringify({
    jsonrpc: "2.0",
    id: "test",
    result: { structuredContent },
  }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  for (const key of [
    "MITOSIS_PILOT_ENABLED",
    "MITOSIS_PILOT_ORG_ID",
    "MITOSIS_MCP_URL",
    "MITOSIS_API_KEY",
    "MITOSIS_AGENT_SURFACE",
    "MITOSIS_TIMEOUT_MS",
  ]) delete process.env[key];
  vi.restoreAllMocks();
});

describe("Mitosis memory pilot", () => {
  it("is fail-closed until the pilot is explicitly enabled", async () => {
    const fetcher = vi.fn();
    const status = await checkMitosisPilotStatus(ORG_ID, fetcher as typeof fetch);
    expect(status).toMatchObject({ enabled: false, configured: false, healthy: false });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("builds a stable, redacted record without customer or account data", () => {
    const record = sanitizeFeedbackForMitosis(ORG_ID, feedback());
    expect(record).not.toBeNull();
    const serialized = JSON.stringify(record);
    expect(serialized).not.toContain("Secret Customer Name");
    expect(serialized).not.toContain("500000");
    expect(serialized).not.toContain("Enterprise");
    expect(serialized).not.toContain("person@example.com");
    expect(serialized).not.toContain("415");
    expect(serialized).not.toContain("hunter2");
    expect(serialized).toContain("[REDACTED_EMAIL]");
    expect(serialized).toContain("[REDACTED_PHONE]");
    expect(serialized).toContain("password=[REDACTED_SECRET]");
    expect(record?.sessionId).toBe(
      sanitizeFeedbackForMitosis(ORG_ID, feedback())?.sessionId,
    );
    expect(sanitizeFeedbackForMitosis(ORG_ID, feedback({ redacted: false }))).toBeNull();
  });

  it("syncs only eligible feedback through stable conversation upserts", async () => {
    configure();
    const requests: RequestInit[] = [];
    const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      requests.push(init ?? {});
      return successResult();
    }) as unknown as typeof fetch;

    const result = await syncSanitizedFeedbackToMitosis({
      orgId: ORG_ID,
      feedback: [feedback(), feedback({ id: "fb_unredacted", redacted: false })],
      fetcher,
    });

    expect(result).toMatchObject({ synced: 1, skipped: 1 });
    expect(requests).toHaveLength(1);
    expect(new Headers(requests[0].headers).get("authorization"))
      .toBe("Bearer mitosis_test_bearer_credential");
    expect(new Headers(requests[0].headers).get("x-mitosis-agent"))
      .toBe("closespan");
    const body = JSON.parse(String(requests[0].body));
    expect(body.params.name).toBe("cortex_ingest_conversation");
    expect(body.params.arguments.session_id).toMatch(/^closespan-feedback-[a-f0-9]{20}$/);
    expect(JSON.stringify(body)).not.toContain("Secret Customer Name");
  });

  it("normalizes answers, citations, source gaps, and safe graph links", () => {
    expect(normalizeMitosisAnswer({
      answer: "Three export reports describe the same failure.",
      citations: [{
        universal_id: "memory_1",
        title: "Sanitized export feedback",
        source: "conversation",
        excerpt: "The generated file is empty.",
      }],
      cited_graph_url: "https://mitosislabs.ai/graph?node=memory_1",
      possible_source_gap: { headline: "More evidence may exist" },
    })).toEqual({
      answer: "Three export reports describe the same failure.",
      citations: [{
        id: "memory_1",
        title: "Sanitized export feedback",
        source: "conversation",
        excerpt: "The generated file is empty.",
      }],
      citedGraphUrl: "https://mitosislabs.ai/graph?node=memory_1",
      possibleSourceGap: true,
    });
  });

  it("exposes retrieval-only Cortex results without claiming a synthesized answer", () => {
    expect(normalizeMitosisAnswer({
      results: [{
        universal_id: "memory_2",
        title: "Sanitized export feedback",
        source_table: "integration_feed",
        preview: "CSV exports over 10,000 rows are blank.",
      }],
      possible_source_gap: { headline: "More evidence may exist" },
    })).toEqual({
      answer: "Mitosis retrieved 1 matching memory record. Review the cited evidence before drawing a conclusion.",
      citations: [{
        id: "memory_2",
        title: "Sanitized export feedback",
        source: "integration_feed",
        excerpt: "CSV exports over 10,000 rows are blank.",
      }],
      citedGraphUrl: null,
      possibleSourceGap: true,
    });
  });

  it("redacts the admin question before sending it to Cortex", async () => {
    configure();
    let requestBody = "";
    const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      requestBody = String(init?.body ?? "");
      return successResult({ answer: "No matching identity was stored.", citations: [] });
    }) as unknown as typeof fetch;

    const answer = await askMitosisMemory({
      orgId: ORG_ID,
      question: "What did person@example.com report? token=topsecret",
      fetcher,
    });

    expect(answer.answer).toBe("No matching identity was stored.");
    expect(requestBody).not.toContain("person@example.com");
    expect(requestBody).not.toContain("topsecret");
    expect(requestBody).toContain("[REDACTED_EMAIL]");
    expect(requestBody).toContain("token=[REDACTED_SECRET]");
  });
});
