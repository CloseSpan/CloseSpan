import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("repository execution branch migration", () => {
  it("backfills the GitHub default branch for existing authorizations", async () => {
    const sql = await readFile(
      path.join(process.cwd(), "db/migrations/064_repository_execution_branch.sql"),
      "utf8",
    );
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS execution_branch");
    expect(sql).toContain("SET execution_branch=default_branch");
    expect(sql).toContain("ALTER COLUMN execution_branch SET NOT NULL");
  });
});
