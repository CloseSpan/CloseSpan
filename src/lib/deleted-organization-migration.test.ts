import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("deleted organization tombstones migration", () => {
  it("stores only the organization identity and deletion time", async () => {
    const migration = await readFile(
      path.join(
        process.cwd(),
        "db/migrations/048_deleted_organizations.sql",
      ),
      "utf8",
    );

    expect(migration).toContain("CREATE TABLE IF NOT EXISTS deleted_organizations");
    expect(migration).toContain("organization_id text PRIMARY KEY");
    expect(migration).toContain("organization_name text NOT NULL");
    expect(migration).toContain("deleted_at timestamptz NOT NULL DEFAULT now()");
    expect(migration).not.toMatch(/org_id.*REFERENCES organizations/);
  });
});
