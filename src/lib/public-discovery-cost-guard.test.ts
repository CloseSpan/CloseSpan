import { afterEach, describe, expect, it } from "vitest";
import {
  claimPublicDiscoveryRequest,
  resetPublicDiscoveryCostGuardForTests,
} from "./public-discovery-cost-guard";

afterEach(() => {
  resetPublicDiscoveryCostGuardForTests();
});

describe("public discovery cost guard", () => {
  it("deduplicates idempotency keys without consuming another claim", async () => {
    const claim = {
      orgId: "org_acme",
      actorId: "user_one",
      idempotencyKey: "discovery-one",
      now: new Date("2026-07-20T12:00:00.000Z"),
    };

    await expect(claimPublicDiscoveryRequest(claim)).resolves.toBe("claimed");
    await expect(claimPublicDiscoveryRequest(claim)).resolves.toBe("duplicate");
  });

  it("allows five paid claims per actor and organization each minute", async () => {
    const now = new Date("2026-07-20T12:00:00.000Z");
    for (let index = 0; index < 5; index += 1) {
      await expect(
        claimPublicDiscoveryRequest({
          orgId: "org_acme",
          actorId: "user_one",
          idempotencyKey: `discovery-${index}`,
          now,
        }),
      ).resolves.toBe("claimed");
    }

    await expect(
      claimPublicDiscoveryRequest({
        orgId: "org_acme",
        actorId: "user_one",
        idempotencyKey: "discovery-six",
        now,
      }),
    ).resolves.toBe("rate_limited");

    await expect(
      claimPublicDiscoveryRequest({
        orgId: "org_acme",
        actorId: "user_two",
        idempotencyKey: "discovery-other-actor",
        now,
      }),
    ).resolves.toBe("claimed");
    await expect(
      claimPublicDiscoveryRequest({
        orgId: "org_other",
        actorId: "user_one",
        idempotencyKey: "discovery-other-org",
        now,
      }),
    ).resolves.toBe("claimed");
  });

  it("opens a new claim window after one minute", async () => {
    const start = new Date("2026-07-20T12:00:00.000Z");
    for (let index = 0; index < 5; index += 1) {
      await claimPublicDiscoveryRequest({
        orgId: "org_acme",
        actorId: "user_one",
        idempotencyKey: `window-one-${index}`,
        now: start,
      });
    }

    await expect(
      claimPublicDiscoveryRequest({
        orgId: "org_acme",
        actorId: "user_one",
        idempotencyKey: "window-two-one",
        now: new Date("2026-07-20T12:01:00.001Z"),
      }),
    ).resolves.toBe("claimed");
  });
});
