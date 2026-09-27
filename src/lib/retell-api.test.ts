import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getRetellCall, listRetellCalls, readLimitedText, retellCallSchema, retellFeedback, verifyRetellSignature } from "./retell-api";

const now = 1_800_000_000_000;
const call = { call_id: "call_123", call_status: "ended", end_timestamp: now, transcript: "The export fails for sam@example.com. token=private", call_analysis: { call_summary: "CSV export fails." } };
function signature(body: string, time = now, key = "test-secret") { return `v=${time},d=${createHmac("sha256", key).update(body + time).digest("hex")}`; }
afterEach(() => vi.unstubAllGlobals());

describe("Retell webhook signatures", () => {
  it("validates the exact raw body and millisecond timestamp", () => {
    const body = '{ "event": "call_analyzed" }';
    expect(verifyRetellSignature(body, "test-secret", signature(body), now)).toBe(true);
    expect(verifyRetellSignature(JSON.stringify(JSON.parse(body)), "test-secret", signature(body), now)).toBe(false);
  });
  it.each([null, "", "v=wrong,d=1234", `v=${now},d=zz`, `v=${now},d=${"0".repeat(64)}`])("rejects malformed or incorrect signatures %s", (value) => {
    expect(verifyRetellSignature("{}", "test-secret", value, now)).toBe(false);
  });
  it("rejects expired, future, and wrong-key signatures", () => {
    for (const offset of [-300_001, 300_001]) expect(verifyRetellSignature("{}", "test-secret", signature("{}", now + offset), now)).toBe(false);
    expect(verifyRetellSignature("{}", "test-secret", signature("{}", now, "other"), now)).toBe(false);
  });
});

describe("Retell call normalization", () => {
  it("keeps only relevant fields, redacts identifiers, and preserves the call date", () => {
    const parsed = retellCallSchema.parse({ ...call, from_number: "+15551234567", recording_url: "https://secret.example/audio", metadata: { password: "private" } });
    expect(parsed).not.toHaveProperty("recording_url");
    const feedback = retellFeedback(parsed)!;
    expect(feedback.quote).toContain("CSV export fails.");
    expect(feedback.quote).toContain("[REDACTED_EMAIL]");
    expect(feedback.quote).not.toContain("private");
    expect(feedback.observedAt).toBe(new Date(now).toISOString());
  });
  it("skips unfinished calls, missing analysis, and empty conversations", () => {
    expect(retellFeedback({ ...call, call_status: "ongoing" })).toBeNull();
    expect(retellFeedback({ ...call, call_analysis: null })).toBeNull();
    expect(retellFeedback({ call_id: "1", call_status: "ended", call_analysis: {} })).toBeNull();
  });
  it("bounds persisted text", () => { expect(retellFeedback({ ...call, transcript: "a".repeat(100_000) })!.quote.length).toBeLessThanOrEqual(8_000); });
  it("bounds input before JSON parsing", async () => { await expect(readLimitedText(new Response("a".repeat(200)), 100)).rejects.toMatchObject({ status: 413 }); });
});

describe("read-only Retell API", () => {
  it("uses the documented v3 list endpoint with a bounded batch", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ items: [call], has_more: true, pagination_key: "next" })); vi.stubGlobal("fetch", fetcher);
    expect(await listRetellCalls("test-key", 500)).toHaveLength(1);
    expect(fetcher).toHaveBeenCalledWith("https://api.retellai.com/v3/list-calls", expect.objectContaining({ method: "POST", redirect: "error", cache: "no-store", body: JSON.stringify({ limit: 25, sort_order: "descending" }) }));
  });
  it("validates call IDs before sending any network request", async () => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    await expect(getRetellCall("key", "../../delete-call")).rejects.toMatchObject({ status: 400 });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("rejects a mismatched call identity", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(call)));
    await expect(getRetellCall("key", "call_other")).rejects.toMatchObject({ status: 502 });
  });
  it("does not expose credentials or vendor errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Bearer secret-api-key")));
    await expect(listRetellCalls("secret-api-key")).rejects.toThrow("Retell could not be reached.");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("secret-api-key", { status: 401 })));
    await expect(listRetellCalls("secret-api-key")).rejects.toThrow("Retell rejected this API key.");
  });
});
