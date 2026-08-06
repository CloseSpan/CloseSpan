import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("runtime secret migration", () => {
  it("stores tenant-scoped immutable versions and separate revocations", async () => {
    const sql = await readFile(
      path.join(process.cwd(), "db/migrations/036_runtime_secrets.sql"),
      "utf8",
    );

    expect(sql).toContain("CREATE TABLE IF NOT EXISTS runtime_secrets");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS runtime_secret_versions");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS runtime_secret_revocations");
    expect(sql).toContain("PRIMARY KEY (org_id,secret_id,version)");
    expect(sql).toContain("runtime_secret_versions_immutable");
    expect(sql).toContain("runtime_secret_revocations_immutable");
    expect(sql).toContain("runtime_secrets_identity_immutable");
    expect(sql).toContain("reject_runtime_secret_identity_change");
    expect(sql).toContain("NEW.environment_name IS DISTINCT FROM OLD.environment_name");
    expect(sql).toContain("NEW.scope_type IS DISTINCT FROM OLD.scope_type");
    expect(sql).toContain("NEW.repository IS DISTINCT FROM OLD.repository");
    expect(sql).toContain("NEW.workspace_root IS DISTINCT FROM OLD.workspace_root");
    expect(sql).toContain("NEW.create_idempotency_key IS DISTINCT FROM OLD.create_idempotency_key");
    expect(sql).toContain("REFERENCES runtime_secrets(org_id,id)");
    expect(sql).not.toContain("fingerprint");
  });

  it("enforces valid workspace and repository scopes", async () => {
    const sql = await readFile(
      path.join(process.cwd(), "db/migrations/036_runtime_secrets.sql"),
      "utf8",
    );

    expect(sql).toContain("scope_type IN ('workspace','repository')");
    expect(sql).toContain("scope_type = 'workspace' AND repository = ''");
    expect(sql).toContain("scope_type = 'repository'");
    expect(sql).toContain(
      "UNIQUE (org_id,scope_type,repository,workspace_root,environment_name)",
    );
  });
});
