import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("billing shadow migration", () => {
  it("creates an idempotent ledger and exact feedback insert trigger", async () => {
    const sql = await readFile(
      path.join(process.cwd(), "db/migrations/032_billing_shadow_metering.sql"),
      "utf8",
    );
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS billing_customers");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS billing_event_outbox");
    expect(sql).toContain("UNIQUE (provider,event_id)");
    expect(sql).toContain("AFTER INSERT ON feedback_items");
    expect(sql).toContain("feedback.processed:");
    expect(sql).toContain("ON CONFLICT (provider,event_id) DO NOTHING");
    expect(sql).toContain("SELECT organization.id,'flexprice',organization.id");
    expect(sql).toContain("metering_enabled boolean NOT NULL DEFAULT true");
    expect(sql).toContain("settings.plan_name ILIKE '%demo%'");
    expect(sql).toContain("customer.metering_enabled=true");
    expect(sql).not.toContain("NEW.quote");
    expect(sql).not.toContain("NEW.customer_name");
  });
});
