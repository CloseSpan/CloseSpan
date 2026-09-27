import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
const db = vi.hoisted(() => ({ query: vi.fn(), transaction: vi.fn(), poolQuery: vi.fn() }));
vi.mock("./db", () => ({ databasePool: () => ({ query: db.poolQuery }), transaction: db.transaction, persistenceMode: () => "postgres" }));
import { connectRetell, disconnectRetell, ingestRetellCalls, loadRetellConnection, retellStatus } from "./retell-repository";
import { encryptCredential } from "./credential-crypto";
const call = { call_id: "call_123", call_status: "ended", end_timestamp: 1_800_000_000_000, transcript: "Export fails for sam@example.com", call_analysis: { call_summary: "Export fails" } };
beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv("AI_CREDENTIAL_ENCRYPTION_KEY", "12".repeat(32));
  db.transaction.mockImplementation((work) => work({ query: db.query }));
  db.query.mockResolvedValue({ rowCount: 1, rows: [{ id: "int_retell" }] }); db.poolQuery.mockResolvedValue({ rows: [] });
});
afterEach(() => vi.unstubAllEnvs());
describe("Retell tenant-scoped persistence", () => {
  it("encrypts keys and returns no secret data", async () => {
    const status = await connectRetell("org_one", "admin", "private-retell-api-key");
    const secretInsert = db.query.mock.calls.find(([sql]) => sql.includes("INSERT INTO integration_webhook_secrets"))!;
    expect(JSON.stringify(secretInsert)).not.toContain("private-retell-api-key");
    expect(secretInsert[1][0]).toBe("org_one");
    expect(JSON.stringify(status)).not.toContain("private-retell-api-key");
  });
  it("loads credentials only in the requested workspace and validates the encryption scope", async () => {
    const encrypted = encryptCredential("private-key", "org_one", "int_retell");
    db.poolQuery.mockResolvedValue({ rows: [{ org_id: "org_one", public_id: "retell_abc", encrypted_secret: encrypted.ciphertext, secret_iv: encrypted.iv, secret_auth_tag: encrypted.authTag }] });
    expect((await loadRetellConnection({ orgId: "org_one" }))?.apiKey).toBe("private-key");
    expect(db.poolQuery).toHaveBeenCalledWith(expect.stringContaining("secret.org_id=$1"), ["org_one"]);
    db.poolQuery.mockResolvedValue({ rows: [{ org_id: "org_other", encrypted_secret: encrypted.ciphertext, secret_iv: encrypted.iv, secret_auth_tag: encrypted.authTag }] });
    await expect(loadRetellConnection({ orgId: "org_other" })).rejects.toThrow();
  });
  it("does not return encrypted credentials from status", async () => {
    db.poolQuery.mockResolvedValue({ rows: [{ public_id: "retell_abc", secret_hint: "•••• key", encrypted_secret: "secret", secret_fingerprint: "fingerprint", last_sync_at: null }] });
    expect(await retellStatus("org_one")).toEqual(expect.objectContaining({ connected: true, keyHint: "•••• key" }));
    expect(JSON.stringify(await retellStatus("org_one"))).not.toContain("fingerprint");
  });
  it("inserts redacted unclassified feedback without generating claims about a bug", async () => {
    expect(await ingestRetellCalls({ orgId: "org_one", publicId: "retell_abc" }, [call])).toMatchObject({ imported: 1, skipped: 0, existing: 0 });
    const insert = db.query.mock.calls.find(([sql]) => sql.includes("INSERT INTO feedback_items"))!;
    expect(insert[0]).toContain("'Question','Low'"); expect(insert[0]).toContain("DO NOTHING");
    expect(insert[1][1]).toBe("org_one"); expect(insert[1][3]).toContain("[REDACTED_EMAIL]");
    expect(insert[1][4]).toBe(call.call_id);
  });
  it("deduplicates without overwriting reviewed feedback", async () => {
    db.query.mockImplementation(async (sql) => ({ rowCount: sql.includes("INSERT INTO feedback_items") ? 0 : 1, rows: [] }));
    expect(await ingestRetellCalls({ orgId: "org_one", publicId: "retell_abc" }, [call])).toMatchObject({ imported: 0, existing: 1 });
    expect(db.query.mock.calls.some(([sql]) => sql.includes("UPDATE feedback_items"))).toBe(false);
  });
  it("rejects stale imports after disconnect or key replacement", async () => {
    db.query.mockResolvedValue({ rowCount: 0, rows: [] });
    await expect(ingestRetellCalls({ orgId: "org_one", publicId: "old_endpoint" }, [call])).rejects.toMatchObject({ status: 409 });
    expect(db.query).toHaveBeenCalledTimes(1);
  });
  it("disconnects only the selected tenant and retains feedback", async () => {
    await disconnectRetell("org_one", "admin");
    expect(db.query.mock.calls.filter(([sql]) => sql.includes("DELETE"))).toEqual([[expect.stringContaining("integration_webhook_secrets WHERE org_id=$1"), ["org_one"]]]);
  });
});
