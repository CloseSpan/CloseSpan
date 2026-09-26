import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("prompt draft threshold migration", () => {
  it("fixes evidence at one and defaults confidence without overwriting saved choices", async () => {
    const sql = await readFile(path.join(process.cwd(), "db/migrations/077_prompt_draft_threshold_defaults.sql"), "utf8");
    expect(sql).toContain("ALTER COLUMN prompt_draft_min_evidence SET DEFAULT 1");
    expect(sql).toContain("ALTER COLUMN prompt_draft_min_confidence SET DEFAULT 0.65");
    expect(sql).toContain("SET prompt_draft_min_evidence=1");
    expect(sql).toContain("CHECK (prompt_draft_min_evidence = 1)");
    expect(sql).not.toMatch(/SET\s+prompt_draft_min_confidence\s*=/i);
  });
});
