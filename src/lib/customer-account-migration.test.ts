import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("customer account source migration", () => {
  async function migrationSql(): Promise<string> {
    return readFile(
      path.join(
        process.cwd(),
        "db/migrations/041_customer_account_sources.sql",
      ),
      "utf8",
    );
  }

  it("keeps upstream customer identities tenant and source scoped", async () => {
    const sql = await migrationSql();

    expect(sql).toContain("CREATE TABLE IF NOT EXISTS account_source_links");
    expect(sql).toContain(
      "PRIMARY KEY (org_id,integration_id,source_namespace,external_account_id)",
    );
    expect(sql).toContain(
      "FOREIGN KEY (org_id,account_id)\n    REFERENCES accounts(org_id,id)",
    );
    expect(sql).toContain(
      "FOREIGN KEY (org_id,integration_id)\n    REFERENCES integrations(org_id,id)",
    );
    expect(sql).not.toContain("UNIQUE (external_account_id)");
  });

  it("links feedback to accounts without relying on a mutable display name", async () => {
    const sql = await migrationSql();

    expect(sql).toContain("ADD COLUMN IF NOT EXISTS account_id text");
    expect(sql).toContain("CONSTRAINT feedback_items_account_fk");
    expect(sql).toContain("REFERENCES accounts(org_id,id) ON DELETE RESTRICT");
    expect(sql).toContain("feedback_items_account_idx");
    expect(sql).not.toContain("regexp_replace(btrim(feedback.customer_name)");
    expect(sql).toContain("Historical display names are not stable customer identifiers");
  });

  it("stores a continuation cursor on each Pipedream connection", async () => {
    const sql = await migrationSql();

    expect(sql).toContain("ALTER TABLE pipedream_connections");
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS import_cursor text");
    expect(sql).toContain(
      "ADD COLUMN IF NOT EXISTS import_generation bigint NOT NULL DEFAULT 0",
    );
    expect(sql).toContain(
      "ADD COLUMN IF NOT EXISTS import_claimed_at timestamptz",
    );
    expect(sql).toContain(
      "pipedream_connections_import_generation_check",
    );
  });

  it("records revenue provenance and synchronizes derived account impacts", async () => {
    const sql = await migrationSql();

    expect(sql).toContain("arr_source text NOT NULL DEFAULT 'manual'");
    expect(sql).toContain("arr_source_priority smallint NOT NULL DEFAULT 50");
    expect(sql).toContain("arr_source_updated_at timestamptz NOT NULL");
    expect(sql).toContain("accounts_arr_source_priority_check");
    expect(sql).toContain("refresh_feedback_problem_account_impact");
    expect(sql).toContain("AFTER UPDATE OF account_id ON feedback_items");
    expect(sql).toContain(
      "AFTER INSERT OR UPDATE OR DELETE ON feedback_cluster_memberships",
    );
  });

  it("cleans up only feedback-derived impacts before feedback cascades", async () => {
    const sql = await migrationSql();

    expect(sql).toContain("cleanup_deleted_feedback_account_impacts");
    expect(sql).toContain("BEFORE DELETE ON feedback_items");
    expect(sql).toContain("other_membership.feedback_id <> OLD.id");
    expect(sql).toContain("impact.origin='feedback'");
  });

  it("marks both provisioned and legacy seeded accounts as demo data", async () => {
    const sql = await migrationSql();
    const seed = await readFile(
      path.join(process.cwd(), "db/seeds/002_overview_analytics.sql"),
      "utf8",
    );
    const provisioner = await readFile(
      path.join(process.cwd(), "scripts/provision-demo.mjs"),
      "utf8",
    );

    expect(sql).toContain("id LIKE 'acct_demo_%'");
    expect(sql).toContain("OR org_id='org_northstar'");
    expect(sql).toContain("profile_source='demo'");
    expect(seed).toContain("profile_source,profile_source_priority");
    expect(seed).toContain("'demo','demo',10,'demo',10");
    expect(provisioner).toContain(
      "profile_source,profile_source_priority,customer_since_known",
    );
    expect(provisioner).toContain(
      "'demo','demo',10,'demo',10,true",
    );
  });

  it("constrains provenance and indexes customer-facing lookups", async () => {
    const sql = await migrationSql();

    expect(sql).toContain("accounts_arr_source_check");
    expect(sql).toContain("accounts_profile_source_check");
    expect(sql).toContain("accounts_non_demo_org_idx");
    expect(sql).toContain("problem_account_impacts_account_idx");
  });
});
