import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("Slack app mention migration", () => {
  const sql = readFileSync(
    join(process.cwd(), "db/migrations/069_slack_app_mentions.sql"),
    "utf8",
  );

  it("persists the Slack app user identity used for exact mentions", () => {
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS bot_user_id text");
    expect(sql).toContain("auth.test");
  });
});
