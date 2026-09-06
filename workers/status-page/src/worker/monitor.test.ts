import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

const initialSchema = readFileSync(new URL("../../migrations/0001_initial.sql", import.meta.url), "utf8");
const incrementalRollup = readFileSync(
  new URL("../../migrations/0003_incremental_daily_rollups.sql", import.meta.url),
  "utf8",
);

interface RollupRow {
  total_checks: number;
  successful_checks: number;
  degraded_checks: number;
  failed_checks: number;
  maintenance_checks: number;
  worst_status: string;
}

describe("status monitoring rollups", () => {
  it("updates the daily aggregate once for each unique check", () => {
    const db = new DatabaseSync(":memory:");
    db.exec(initialSchema);
    db.exec(incrementalRollup);

    const insertCheck = db.prepare(`INSERT OR IGNORE INTO checks
      (id,service_id,scheduled_at,checked_at,status,succeeded,latency_ms,maintenance_excluded,error_code)
      VALUES(?,?,?,?,?,?,?,?,?)`);
    const day = Date.UTC(2026, 8, 6);

    insertCheck.run("check-1", "svc_website", day, day, "operational", 1, 100, 0, null);
    insertCheck.run("check-1-retry", "svc_website", day, day, "operational", 1, 100, 0, null);
    insertCheck.run("check-2", "svc_website", day + 60_000, day + 60_000, "degraded", 1, 3_000, 0, null);
    insertCheck.run("check-3", "svc_website", day + 120_000, day + 120_000, "major_outage", 0, 0, 0, "timeout");
    insertCheck.run("check-4", "svc_website", day + 180_000, day + 180_000, "major_outage", 0, 0, 1, "timeout");

    const rollup = db.prepare(`SELECT total_checks,successful_checks,degraded_checks,
      failed_checks,maintenance_checks,worst_status FROM daily_rollups
      WHERE service_id=? AND day=?`).get("svc_website", "2026-09-06") as unknown as RollupRow;

    expect(rollup).toEqual({
      total_checks: 4,
      successful_checks: 2,
      degraded_checks: 1,
      failed_checks: 1,
      maintenance_checks: 1,
      worst_status: "major_outage",
    });

    db.close();
  });
});
