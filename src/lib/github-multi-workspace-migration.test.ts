import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("GitHub multi-workspace migration", () => {
  it("replaces global installation ownership with tenant-scoped bindings", async () => {
    const sql = await readFile(
      path.join(process.cwd(), "db/migrations/034_github_multi_workspace.sql"),
      "utf8",
    );
    expect(sql).toContain(
      "DROP CONSTRAINT IF EXISTS github_app_installations_installation_id_key",
    );
    expect(sql).toContain("ON github_app_installations(org_id,installation_id)");
    expect(sql).toContain("workspace_connected boolean NOT NULL DEFAULT true");
    expect(sql).toContain("workspace_selected boolean NOT NULL DEFAULT true");
  });

  it("keeps global webhook deduplication with per-workspace outcomes", async () => {
    const sql = await readFile(
      path.join(process.cwd(), "db/migrations/034_github_multi_workspace.sql"),
      "utf8",
    );
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS github_webhook_delivery_workspaces");
    expect(sql).toContain(
      "REFERENCES github_webhook_deliveries(delivery_id) ON DELETE CASCADE",
    );
    expect(sql).toContain("PRIMARY KEY (delivery_id,org_id)");
  });
});
