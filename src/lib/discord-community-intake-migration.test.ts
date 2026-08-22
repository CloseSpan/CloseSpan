import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = join(
  process.cwd(),
  "db/migrations/073_discord_community_intake.sql",
);

describe("Discord community intake migration", () => {
  it("keeps each Discord server bound to one workspace", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).toContain("guild_id text NOT NULL UNIQUE");
    expect(sql).toContain("org_id text PRIMARY KEY REFERENCES organizations(id)");
  });

  it("persists explicit listening policy and confirmation state", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).toContain("CHECK (intake_mode IN ('commands','channels'))");
    expect(sql).toContain("monitored_channel_ids jsonb");
    expect(sql).toContain("CHECK (state IN ('Review','Confirmed','Ignored'))");
    expect(sql).toContain("submitted_by_id text");
    expect(sql).toContain("confirmation_sent_at timestamptz");
  });

  it("preserves Discord provenance for normalized feedback", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS discord_feedback_sources");
    expect(sql).toContain("UNIQUE (org_id,guild_id,channel_id,message_id)");
    expect(sql).toContain("REFERENCES feedback_items(org_id,id) ON DELETE CASCADE");
  });
});
