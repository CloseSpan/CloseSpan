import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("feature request database migration", () => {
  it("enforces one vote per request and fingerprint in PostgreSQL", async () => {
    const migration = await readFile(
      path.join(process.cwd(), "db/migrations/020_feature_requests.sql"),
      "utf8",
    );

    expect(migration).toContain("PRIMARY KEY (request_id,voter_hash)");
    expect(migration).toContain(
      "voter_hash text NOT NULL CHECK (voter_hash ~ '^[0-9a-f]{64}$')",
    );
    expect(migration).toContain("moderation_status text NOT NULL DEFAULT 'Pending review'");
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS feature_request_rate_limits");
    expect(migration).not.toContain("submitted_by_hash");
    expect(migration).not.toMatch(/\braw_ip\b|\bip_address\b/i);
  });
});
