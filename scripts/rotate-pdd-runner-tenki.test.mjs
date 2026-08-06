import { describe, expect, it } from "vitest";
import { enabled, rotationReason } from "./rotate-pdd-runner-tenki.mjs";

function runner(overrides = {}) {
  const { metadata, ...rest } = overrides;
  return {
    state: "RUNNING",
    metadata: {
      releaseId: "release-current",
      pddVersion: "0.0.309",
      deployedAt: "2026-08-01T00:00:00.000Z",
      ...metadata,
    },
    ...rest,
  };
}

describe("PDD runner rotation policy", () => {
  it("keeps a healthy current release below its maximum age", () => {
    expect(rotationReason({
      current: runner(),
      release: "release-current",
      maxAgeDays: 21,
      healthy: true,
      force: false,
      now: Date.parse("2026-08-06T00:00:00.000Z"),
    })).toBeNull();
  });

  it("rotates for force, health, release, state, and age boundaries", () => {
    const base = {
      current: runner(),
      release: "release-current",
      maxAgeDays: 21,
      healthy: true,
      force: false,
      now: Date.parse("2026-08-06T00:00:00.000Z"),
    };
    expect(rotationReason({ ...base, force: true })).toBe("operator-forced");
    expect(rotationReason({ ...base, healthy: false })).toBe("health-check-failed");
    expect(rotationReason({ ...base, release: "release-next" })).toBe("runner-release-changed");
    expect(rotationReason({ ...base, current: runner({ state: "PAUSED" }) })).toBe("runner-state-paused");
    expect(rotationReason({
      ...base,
      now: Date.parse("2026-08-22T00:00:00.000Z"),
    })).toBe("runner-max-age-reached");
  });

  it("fails closed when deployment age cannot be attested", () => {
    expect(rotationReason({
      current: runner({ metadata: { deployedAt: "not-a-date" } }),
      release: "release-current",
      maxAgeDays: 21,
      healthy: true,
      force: false,
    })).toBe("runner-age-unknown");
  });

  it("parses only explicit truthy force values", () => {
    expect(enabled("true")).toBe(true);
    expect(enabled("1")).toBe(true);
    expect(enabled("yes")).toBe(true);
    expect(enabled("false")).toBe(false);
    expect(enabled(undefined)).toBe(false);
  });
});
