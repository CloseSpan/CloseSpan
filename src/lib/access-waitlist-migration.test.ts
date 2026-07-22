import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("workspace access waitlist migration", () => {
  it("stores one global row per normalized email without tenant access", async () => {
    const migration = await readFile(
      path.join(
        process.cwd(),
        "db/migrations/021_workspace_access_waitlist.sql",
      ),
      "utf8",
    );

    expect(migration).toContain("email text PRIMARY KEY");
    expect(migration).toContain("login_attempt_count integer NOT NULL DEFAULT 1");
    expect(migration).toContain("first_attempted_at timestamptz NOT NULL");
    expect(migration).toContain("last_attempted_at timestamptz NOT NULL");
    expect(migration).not.toMatch(/\borg_id\b|REFERENCES organizations/i);
  });
});
