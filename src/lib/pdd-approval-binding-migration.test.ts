import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("PDD approval binding migration", () => {
  it("backfills and locks the exact tenant-scoped verification on approvals", async () => {
    const sql = await readFile(
      path.join(process.cwd(), "db/migrations/035_pdd_approval_binding.sql"),
      "utf8",
    );

    expect(sql).toContain("ADD COLUMN IF NOT EXISTS pdd_verification_id uuid");
    expect(sql).toContain("SET pdd_verification_id=run.pdd_verification_id");
    expect(sql).toContain("approval.status='Pending'");
    expect(sql).toContain("verification.status='Ready for approval'");
    expect(sql).toContain("FOREIGN KEY (org_id,pdd_verification_id)");
    expect(sql).toContain("REFERENCES pdd_prompt_verifications(org_id,id) ON DELETE RESTRICT");
    expect(sql).toContain("reject_pdd_approval_binding_change");
    expect(sql).toContain("OLD.pdd_verification_id IS NOT NULL");
    expect(sql).toContain("reject_completed_pdd_artifact_change");
    expect(sql).toContain("NEW.generated_tests IS DISTINCT FROM OLD.generated_tests");
    expect(sql).toContain("NEW.prompt_hash IS DISTINCT FROM OLD.prompt_hash");
    expect(sql).toContain("NEW.execution_profile_snapshot IS DISTINCT FROM OLD.execution_profile_snapshot");
    expect(sql).toContain("NEW.completed_at IS DISTINCT FROM OLD.completed_at");
    expect(sql).toContain("NEW.status NOT IN ('Ready for approval','Superseded')");
    expect(sql).toContain("OLD.status='Superseded' AND NEW.status <> 'Superseded'");
    expect(sql).toContain("WHERE status IN ('Queued','Generating tests')");
    expect(sql).toContain("enforce_agent_run_pdd_approval_binding");
    expect(sql).toContain("approval_pdd_verification_id IS DISTINCT FROM NEW.pdd_verification_id");
    expect(sql).toContain("BEFORE INSERT ON agent_runs");
    expect(sql).toContain("BEFORE UPDATE OF org_id,approval_id,pdd_verification_id ON agent_runs");
  });
});
