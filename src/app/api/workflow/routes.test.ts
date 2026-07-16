import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { POST as approve } from "./approve/route";
import { POST as advance } from "./advance/route";
import { resetDemoState } from "@/lib/store";

const request = (path: string, options: { orgId?: string; key?: string; origin?: string } = {}) => new NextRequest(`http://localhost${path}`, {
  method: "POST",
  headers: {
    ...(options.orgId ? { "x-org-id": options.orgId } : {}),
    ...(options.key ? { "idempotency-key": options.key } : {}),
    ...(options.origin ? { origin: options.origin } : {}),
  },
});

describe("workflow API boundary", () => {
  beforeEach(() => { resetDemoState(); process.env.APP_MODE = "demo"; });
  afterEach(() => { delete process.env.AUTH_TRUSTED_PROXY; delete process.env.TRUSTED_PROXY_SECRET; });

  it("rejects actions without organization scope", async () => {
    const response = await approve(request("/api/workflow/approve", { key: "approve_001" }));
    expect(response.status).toBe(403);
  });

  it("requires a valid idempotency key", async () => {
    const response = await approve(request("/api/workflow/approve", { orgId: "org_northstar" }));
    expect(response.status).toBe(400);
  });

  it("rejects cross-origin mutations", async () => {
    const response = await approve(request("/api/workflow/approve", { orgId: "org_northstar", key: "approve_001", origin: "https://evil.example" }));
    expect(response.status).toBe(403);
  });

  it("replays an idempotent approval without duplicating audit entries", async () => {
    const command = request("/api/workflow/approve", { orgId: "org_northstar", key: "approve_001" });
    expect((await approve(command)).status).toBe(200);
    const replay = await approve(request("/api/workflow/approve", { orgId: "org_northstar", key: "approve_001" }));
    expect(replay.status).toBe(200);
    expect((await replay.json()).state.audit.filter((item: { action: string }) => item.action.includes("GH-1842"))).toHaveLength(1);
  });

  it("advances only after approval", async () => {
    const blocked = await advance(request("/api/workflow/advance", { orgId: "org_northstar", key: "advance_001" }));
    expect(blocked.status).toBe(409);
    await approve(request("/api/workflow/approve", { orgId: "org_northstar", key: "approve_001" }));
    const response = await advance(request("/api/workflow/advance", { orgId: "org_northstar", key: "advance_001" }));
    expect((await response.json()).state.problemStage).toBe("Planned");
  });

  it("fails closed when production authentication is not configured", async () => {
    process.env.APP_MODE = "production";
    const response = await approve(request("/api/workflow/approve", { orgId: "org_northstar", key: "approve_001" }));
    expect(response.status).toBe(503);
    process.env.APP_MODE = "demo";
  });
});
