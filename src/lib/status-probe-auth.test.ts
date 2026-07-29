import { describe, expect, it } from "vitest";
import { validStatusProbe } from "./status-probe-auth";

describe("status probe authentication", () => {
  it("accepts the expected bearer secret", async () => {
    const request = new Request("https://www.closespan.com/api/health/components", {
      headers: { authorization: "Bearer a-long-monitoring-secret" },
    });
    await expect(validStatusProbe(request, "a-long-monitoring-secret")).resolves.toBe(true);
  });

  it("rejects missing and incorrect secrets", async () => {
    await expect(validStatusProbe(new Request("https://www.closespan.com/api/health/components"), "expected")).resolves.toBe(false);
    await expect(validStatusProbe(new Request("https://www.closespan.com/api/health/components", {
      headers: { authorization: "Bearer incorrect" },
    }), "expected")).resolves.toBe(false);
  });
});
