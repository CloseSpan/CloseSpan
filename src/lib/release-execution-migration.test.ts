import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("release execution workflow migration", () => {
  it("persists immutable approval evidence and idempotent execution records", async () => {
    const sql = await readFile(
      path.join(process.cwd(), "db/migrations/046_release_execution_workflow.sql"),
      "utf8",
    );
    expect(sql).toContain("evidence_snapshot jsonb NOT NULL");
    expect(sql).toContain("execution_action IN ('merge_pull_request','deploy')");
    expect(sql).toContain("UNIQUE (org_id,provider,delivery_id)");
    expect(sql).toContain("UNIQUE (org_id,release_event_id)");
    expect(sql).toContain("post_release_verification_jobs");
    expect(sql).toContain("implementationReport");
  });

  it("stores sealed UI plans, baselines, bounded retries, and verifier evidence", async () => {
    const sql = await readFile(
      path.join(process.cwd(), "db/migrations/047_ui_release_verification.sql"),
      "utf8",
    );
    expect(sql).toContain("verification_plan jsonb");
    expect(sql).toContain("ui_baseline jsonb");
    expect(sql).toContain("verification_result jsonb");
    expect(sql).toContain("attempt_count integer NOT NULL DEFAULT 0");
    expect(sql).toContain("attempt_count >= 0 AND attempt_count <= 20");
    expect(sql).toContain("expires_at timestamptz");
  });
});
