import { afterEach, describe, expect, it, vi } from "vitest";
import type { IntegrationImport } from "@/lib/integration-client";
import { importIsDelayed } from "./integration-sync-status";

function activeImport(
  overrides: Partial<IntegrationImport> = {},
): IntegrationImport {
  return {
    id: "sync_1",
    syncName: "feedback-backfill",
    model: "feedback",
    status: "Queued",
    recordsProcessed: 0,
    pagesProcessed: 0,
    attempts: 0,
    queuedAt: "2026-07-20T17:00:00.000Z",
    startedAt: null,
    completedAt: null,
    nextAttemptAt: null,
    lastErrorCode: null,
    ...overrides,
  };
}

describe("importIsDelayed", () => {
  afterEach(() => vi.useRealTimers());

  it("turns an old active import into a bounded background state", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-20T17:06:00.000Z"));

    expect(importIsDelayed(activeImport())).toBe(true);
    expect(
      importIsDelayed(
        activeImport({
          status: "Running",
          startedAt: "2026-07-20T17:00:30.000Z",
        }),
      ),
    ).toBe(true);
  });

  it("keeps recent work active and ignores terminal imports", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-20T17:03:00.000Z"));

    expect(importIsDelayed(activeImport())).toBe(false);
    expect(importIsDelayed(activeImport({ status: "Succeeded" }))).toBe(false);
    expect(importIsDelayed(null)).toBe(false);
  });
});
