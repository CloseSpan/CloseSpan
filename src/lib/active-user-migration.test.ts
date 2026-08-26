import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("platform user activity migration", () => {
  it("stores normalized sign-in activity without tenant data", async () => {
    const migration = await readFile(
      path.join(
        process.cwd(),
        "db/migrations/076_platform_user_activity.sql",
      ),
      "utf8",
    );

    expect(migration).toContain("email text PRIMARY KEY");
    expect(migration).toContain("sign_in_count integer NOT NULL DEFAULT 1");
    expect(migration).toContain("first_signed_in_at timestamptz NOT NULL");
    expect(migration).toContain("last_signed_in_at timestamptz NOT NULL");
    expect(migration).not.toMatch(/REFERENCES organizations/i);
  });
});
