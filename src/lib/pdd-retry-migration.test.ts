import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  new URL("../../db/migrations/042_pdd_retry_attempts.sql", import.meta.url),
  "utf8",
);

describe("Prompt Testing retry migration", () => {
  it("preserves failed attempts while allowing one new active attempt", () => {
    expect(sql).toContain("DROP CONSTRAINT IF EXISTS pdd_prompt_verifications_org_id_prompt_revision_id_story_hash_key");
    expect(sql).toContain("WHERE status IN ('Queued','Generating tests','Ready for approval')");
    expect(sql).not.toContain("DELETE FROM pdd_prompt_verifications");
  });
});
