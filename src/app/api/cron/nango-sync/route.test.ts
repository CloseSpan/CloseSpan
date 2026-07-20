import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { GET, workerRequestAuthorized } from "./route";
import { resetNangoSyncMemoryState } from "@/lib/nango-sync-repository";

const secret = "cron-secret-with-at-least-16-characters";

function request(authorization?: string) {
  return new NextRequest("http://localhost/api/cron/nango-sync", {
    headers: authorization ? { authorization } : undefined,
  });
}

describe("Nango sync cron route", () => {
  beforeEach(() => {
    process.env.PERSISTENCE_MODE = "memory";
    process.env.APP_MODE = "demo";
    process.env.CRON_SECRET = secret;
    resetNangoSyncMemoryState();
  });

  afterEach(() => {
    resetNangoSyncMemoryState();
    delete process.env.PERSISTENCE_MODE;
    delete process.env.APP_MODE;
    delete process.env.CRON_SECRET;
  });

  it("uses a constant-time bearer comparison and rejects invalid callers", async () => {
    expect(workerRequestAuthorized(`Bearer ${secret}`, secret)).toBe(true);
    expect(workerRequestAuthorized("Bearer wrong-secret", secret)).toBe(false);
    expect(workerRequestAuthorized(null, secret)).toBe(false);

    const response = await GET(request("Bearer wrong-secret"));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
  });

  it("fails closed when the worker secret is missing", async () => {
    delete process.env.CRON_SECRET;
    const response = await GET(request());
    expect(response.status).toBe(503);
  });

  it("runs a bounded empty drain for an authorized scheduler", async () => {
    const response = await GET(request(`Bearer ${secret}`));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      claimed: 0,
      succeeded: 0,
      yielded: 0,
      retrying: 0,
      failed: 0,
      recordsProcessed: 0,
    });
  });
});
