import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("Slack conversation intake migration", () => {
  const sql = readFileSync(
    join(process.cwd(), "db/migrations/068_slack_conversation_intake.sql"),
    "utf8",
  );

  it("persists reviewable conversation candidates and their promotion state", () => {
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS slack_intake_candidates");
    expect(sql).toContain("'Pending','Review','Confirmed','Ignored','Deleted'");
    expect(sql).toContain("message_snapshots jsonb");
    expect(sql).toContain("promoted_feedback_id text");
    expect(sql).toContain("confirmation_message_ts text");
  });
});
