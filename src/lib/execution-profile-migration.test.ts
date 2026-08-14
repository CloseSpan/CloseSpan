import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("execution profile migration", () => {
  it("separates immutable versions, detected suggestions, and active assignments", async () => {
    const sql = await readFile(
      path.join(process.cwd(), "db/migrations/033_execution_profiles.sql"),
      "utf8",
    );

    expect(sql).toContain("CREATE TABLE IF NOT EXISTS execution_profile_versions");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS execution_profile_assignments");
    expect(sql).toContain("active_profile_id uuid");
    expect(sql).toContain("detected_profile_id uuid");
    expect(sql).toContain("execution_profile_versions_immutable");
    expect(sql).toContain("content_hash text NOT NULL CHECK");
    expect(sql).toContain("UNIQUE (org_id,repository,workspace_root,version)");
  });

  it("persists an administrator opt-out from automatic profile activation", async () => {
    const sql = await readFile(
      path.join(process.cwd(), "db/migrations/063_execution_profile_auto_activation.sql"),
      "utf8",
    );
    expect(sql).toContain("automatic_activation_disabled boolean NOT NULL DEFAULT false");
  });

  it("binds problems and every approval artifact to a tenant-safe immutable profile", async () => {
    const sql = await readFile(
      path.join(process.cwd(), "db/migrations/033_execution_profiles.sql"),
      "utf8",
    );

    expect(sql).toContain("CREATE TABLE IF NOT EXISTS problem_repository_matches");
    expect(sql).toContain("REFERENCES product_problems(org_id,id)");
    expect(sql).toContain("status IN ('Suggested','Confirmed','Rejected')");
    expect(sql).toContain("problem_repository_matches_one_confirmed_idx");
    expect(sql).toContain("WHERE status='Confirmed'");
    for (const table of [
      "engineering_ticket_specifications",
      "pdd_prompt_verifications",
      "approval_requests",
      "agent_runs",
    ]) {
      expect(sql).toContain(`ALTER TABLE ${table}`);
    }
    expect(sql).toContain(
      "FOREIGN KEY (org_id,execution_profile_id,execution_profile_hash)",
    );
    expect(sql).toContain("execution_profile_snapshot jsonb");
    expect(sql).toContain("reject_execution_profile_binding_change");
  });

  it("lets a terminal retry advance only the mutable ticket preparation context", async () => {
    const sql = await readFile(
      path.join(
        process.cwd(),
        "db/migrations/066_terminal_retry_execution_profile_rebinding.sql",
      ),
      "utf8",
    );

    expect(sql).toContain(
      "DROP TRIGGER IF EXISTS ticket_specs_execution_profile_immutable",
    );
    expect(sql).toContain("ON engineering_ticket_specifications");
    expect(sql).not.toMatch(
      /DROP TRIGGER IF EXISTS (?:pdd_verifications|approval_requests|agent_runs)_execution_profile_immutable/,
    );
  });
});
