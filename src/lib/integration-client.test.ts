import { describe, expect, it } from "vitest";
import {
  normalizeProductUrl,
  parseIntegrationSyncStatusResponse,
  parsePublicSourceDiscoveryResponse,
} from "./integration-client";

describe("normalizeProductUrl", () => {
  it("adds https to a domain-only model response", () => {
    expect(normalizeProductUrl("feelow.ai/product")).toBe(
      "https://feelow.ai/product",
    );
  });

  it.each([
    "not a product URL",
    "file:///etc/passwd",
    "https://localhost:3000",
    "http://127.0.0.1/internal",
    "https://user:secret@example.com",
  ])("drops invalid or private product URL %s", (value) => {
    expect(normalizeProductUrl(value)).toBeNull();
  });
});

describe("parsePublicSourceDiscoveryResponse", () => {
  it("keeps valid public web results and drops unsafe URLs", () => {
    const result = parsePublicSourceDiscoveryResponse({
      status: "completed",
      provider: "you",
      sources: [
        {
          id: "source_1",
          title: "Feelow reviews",
          url: "https://example.com/reviews",
          host: "example.com",
          kind: "review_site",
          reason: "A likely public review profile.",
          confidence: "high",
          discoveredBy: "you",
        },
        {
          id: "source_2",
          title: "Unsafe result",
          url: "javascript:alert(1)",
          host: "example.com",
          kind: "other",
          reason: "Invalid protocol.",
          confidence: "low",
          discoveredBy: "you",
        },
      ],
    });

    expect(result?.status).toBe("completed");
    expect(result?.sources).toHaveLength(1);
    expect(result?.sources[0]?.url).toBe("https://example.com/reviews");
  });

  it("accepts disabled discovery without public results", () => {
    expect(
      parsePublicSourceDiscoveryResponse({
        status: "disabled",
        provider: null,
        sources: [],
      }),
    ).toEqual({ status: "disabled", provider: null, sources: [] });
  });
});

describe("parseIntegrationSyncStatusResponse", () => {
  it("parses an active background import", () => {
    const result = parseIntegrationSyncStatusResponse({
      integrationId: "int_zendesk",
      connectionState: "Connected",
      sync: {
        id: "sync_1",
        syncName: "tickets",
        model: "Ticket",
        status: "Running",
        recordsProcessed: 320,
        pagesProcessed: 4,
        attempts: 1,
        queuedAt: "2026-07-20T10:00:00.000Z",
        startedAt: "2026-07-20T10:00:01.000Z",
        completedAt: null,
        nextAttemptAt: null,
        lastErrorCode: null,
      },
    });

    expect(result?.sync?.status).toBe("Running");
    expect(result?.sync?.recordsProcessed).toBe(320);
  });

  it("rejects malformed progress counters", () => {
    expect(
      parseIntegrationSyncStatusResponse({
        integrationId: "int_zendesk",
        connectionState: "Connected",
        sync: {
          id: "sync_1",
          syncName: "tickets",
          model: "Ticket",
          status: "Running",
          recordsProcessed: -1,
          pagesProcessed: 0,
          attempts: 1,
          queuedAt: "2026-07-20T10:00:00.000Z",
          startedAt: null,
          completedAt: null,
          nextAttemptAt: null,
          lastErrorCode: null,
        },
      }),
    ).toBeNull();
  });
});
