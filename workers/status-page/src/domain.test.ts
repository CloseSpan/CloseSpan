import { describe, expect, it } from "vitest";
import { historyDays, nextServiceState, overallStatus, shouldDeferPrelaunchProbe, uptimePercentage } from "./domain";

describe("status domain", () => {
  it("degrades on the first failure and opens an outage on the second", () => {
    const first = nextServiceState({
      currentStatus: "operational",
      consecutiveFailures: 0,
      consecutiveSuccesses: 3,
      consecutiveSlow: 0,
      succeeded: false,
      slow: false,
    });
    expect(first.status).toBe("degraded");
    expect(nextServiceState({
      currentStatus: first.status,
      consecutiveFailures: first.consecutiveFailures,
      consecutiveSuccesses: first.consecutiveSuccesses,
      consecutiveSlow: first.consecutiveSlow,
      succeeded: false,
      slow: false,
    }).status).toBe("major_outage");
  });

  it("requires two successful checks to recover from an outage", () => {
    const first = nextServiceState({
      currentStatus: "major_outage",
      consecutiveFailures: 2,
      consecutiveSuccesses: 0,
      consecutiveSlow: 0,
      succeeded: true,
      slow: false,
    });
    expect(first.status).toBe("major_outage");
    expect(nextServiceState({
      currentStatus: first.status,
      consecutiveFailures: first.consecutiveFailures,
      consecutiveSuccesses: first.consecutiveSuccesses,
      consecutiveSlow: first.consecutiveSlow,
      succeeded: true,
      slow: false,
    }).status).toBe("operational");
  });

  it("marks a service degraded after three slow checks", () => {
    const result = nextServiceState({
      currentStatus: "operational",
      consecutiveFailures: 0,
      consecutiveSuccesses: 2,
      consecutiveSlow: 2,
      succeeded: true,
      slow: true,
    });
    expect(result.status).toBe("degraded");
  });

  it("calculates aggregate status without treating maintenance as an outage", () => {
    expect(overallStatus(["operational", "maintenance"])).toBe("maintenance");
    expect(overallStatus(["operational", "major_outage"])).toBe("partial_outage");
    expect(overallStatus(["major_outage", "major_outage"])).toBe("major_outage");
  });

  it("excludes maintenance and returns no result when there is no eligible data", () => {
    expect(uptimePercentage(95, 100, 5)).toBe(100);
    expect(uptimePercentage(0, 5, 5)).toBeNull();
  });

  it("generates an inclusive UTC history without fabricated entries", () => {
    expect(historyDays(Date.UTC(2026, 6, 29), 3)).toEqual(["2026-07-27", "2026-07-28", "2026-07-29"]);
  });

  it("keeps an uninstalled protected canary as no data until monitoring starts", () => {
    expect(shouldDeferPrelaunchProbe({
      probeKind: "component",
      lastCheckedAt: null,
      succeeded: false,
      errorCode: "http_404",
    })).toBe(true);
    expect(shouldDeferPrelaunchProbe({
      probeKind: "component",
      lastCheckedAt: Date.now(),
      succeeded: false,
      errorCode: "http_404",
    })).toBe(false);
    expect(shouldDeferPrelaunchProbe({
      probeKind: "api",
      lastCheckedAt: null,
      succeeded: false,
      errorCode: "http_404",
    })).toBe(false);
  });
});
