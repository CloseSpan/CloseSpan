import { describe, expect, it } from "vitest";
import { normalizeNangoRecord } from "./nango-sync-normalizer";

const context = { orgId: "org_alpha", integrationId: "int_zendesk" };

describe("Nango feedback record normalization", () => {
  it("maps a bounded provider record into the canonical feedback shape", () => {
    const normalized = normalizeNangoRecord(
      {
        id: 42,
        ticket: {
          description:
            "<p>CSV export <strong>fails</strong> for enterprise reports.</p>",
        },
        requester: { name: "Ada Customer" },
        account: { tier: "Enterprise", arr: 125_000 },
        priority: "high",
        environment: "Production",
        created_at: "2026-07-20T10:00:00.000Z",
        _nango_metadata: {
          last_action: "ADDED",
          cursor: "cursor-42",
          last_modified_at: "2026-07-20T10:01:00.000Z",
        },
      },
      context,
      new Date("2026-07-20T11:00:00.000Z"),
    );

    expect(normalized).toEqual(
      expect.objectContaining({
        externalId: "42",
        action: "ADDED",
        nangoCursor: "cursor-42",
        outcome: "Ingested",
        payloadHash: expect.stringMatching(/^[0-9a-f]{64}$/),
        feedback: expect.objectContaining({
          id: expect.stringMatching(/^fb_nango_[0-9a-f]{32}$/),
          source: "Zendesk",
          customerName: "Ada Customer",
          accountTier: "Enterprise",
          arr: 125_000,
          type: "Bug",
          severity: "High",
          environment: "Production",
          observedAt: "2026-07-20T10:00:00.000Z",
          quote: "CSV export fails for enterprise reports.",
        }),
      }),
    );
  });

  it("accepts a deletion without trusting or requiring provider content", () => {
    const normalized = normalizeNangoRecord(
      {
        id: "ticket-deleted",
        _nango_metadata: { last_action: "deleted", cursor: "cursor-delete" },
      },
      context,
    );

    expect(normalized).toEqual(
      expect.objectContaining({
        externalId: "ticket-deleted",
        action: "DELETED",
        outcome: "Deleted",
        feedback: null,
      }),
    );
  });

  it("records unsupported shapes as skipped and rejects records without IDs", () => {
    expect(
      normalizeNangoRecord(
        { id: "opaque", arbitrary: { nested: "not feedback" } },
        context,
      ),
    ).toEqual(
      expect.objectContaining({
        externalId: "opaque",
        outcome: "Skipped",
        feedback: null,
      }),
    );
    expect(normalizeNangoRecord({ body: "missing ID" }, context)).toBeNull();
    expect(normalizeNangoRecord(["not", "an", "object"], context)).toBeNull();
  });

  it("bounds identifiers and text before they reach PostgreSQL", () => {
    const normalized = normalizeNangoRecord(
      {
        id: "external-".repeat(200),
        body: `  ${"A".repeat(12_000)}\u0000  `,
        _nango_metadata: { last_action: "unexpected-provider-value" },
      },
      { orgId: "org_alpha", integrationId: "unknown" },
    );

    expect(normalized?.externalId).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(normalized?.externalId.length).toBeLessThanOrEqual(512);
    expect(normalized?.action).toBe("UPDATED");
    expect(normalized?.feedback?.source).toBe("Connected app");
    expect(normalized?.feedback?.quote).toHaveLength(10_000);
    expect(normalized?.feedback?.quote).not.toContain("\u0000");
  });

  it("namespaces deterministic feedback IDs by Nango stream", () => {
    const value = { id: "42", body: "Same provider ID in two models" };
    const ticket = normalizeNangoRecord(value, {
      ...context,
      sourceNamespace: "nango:ticket-stream",
    });
    const comment = normalizeNangoRecord(value, {
      ...context,
      sourceNamespace: "nango:comment-stream",
    });

    expect(ticket?.feedback?.id).not.toBe(comment?.feedback?.id);
  });
});
