import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { POST as approve } from "./approve/route";
import { POST as advance } from "./advance/route";
import { GET as readState } from "./state/route";
import { POST as analyze } from "../ai/analyze/route";
import { resetDemoState } from "@/lib/store";
import { authorizeAdminMutation } from "@/lib/request-security";

const request = (path: string, options: { orgId?: string; key?: string; origin?: string; authenticated?: boolean; role?: string } = {}) => new NextRequest(`http://localhost${path}`, {
  method: "POST",
  headers: {
    ...(options.orgId ? { "x-org-id": options.orgId } : {}),
    ...(options.key ? { "idempotency-key": options.key } : {}),
    ...(options.origin ? { origin: options.origin } : {}),
    ...(options.authenticated === false ? { "x-test-auth": "none" } : {}),
    ...(options.role ? { "x-test-user-role": options.role } : {}),
  },
});

describe("workflow API boundary", () => {
  beforeEach(() => { resetDemoState(); process.env.APP_MODE = "demo"; });
  afterEach(() => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.XAI_API_KEY;
  });

  it("derives organization scope from the authenticated user", async () => {
    const response = await approve(request("/api/workflow/approve", { key: "approve_001" }));
    expect(response.status).toBe(200);
  });

  it("rejects unauthenticated actions", async () => {
    const response = await approve(request("/api/workflow/approve", { authenticated:false, key:"approve_001" }));
    expect(response.status).toBe(401);
  });

  it("rejects a conflicting organization header", async () => {
    const response = await approve(request("/api/workflow/approve", { orgId:"org_other", key:"approve_001" }));
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

  it("accepts loopback port normalization only in demo mode", async () => {
    const response = await approve(request("/api/workflow/approve", { orgId:"org_northstar", key:"approve_loopback", origin:"http://localhost:3001" }));
    expect(response.status).toBe(200);
  });

  it("does not allow the loopback proxy exception in production", async () => {
    process.env.APP_MODE = "production";
    const response = await approve(request("/api/workflow/approve", { orgId:"org_northstar", key:"approve_loopback_prod", origin:"http://localhost:3001" }));
    expect(response.status).toBe(403);
  });

  it("replays an idempotent approval without duplicating audit entries", async () => {
    const command = request("/api/workflow/approve", { orgId: "org_northstar", key: "approve_001" });
    expect((await approve(command)).status).toBe(200);
    const replay = await approve(request("/api/workflow/approve", { orgId: "org_northstar", key: "approve_001" }));
    expect(replay.status).toBe(200);
    expect((await replay.json()).state.audit.filter((item: { action: string }) => item.action.includes("GH-1842"))).toHaveLength(1);
  });

  it("scopes a workflow action to the requested issue", async () => {
    const other = await approve(request("/api/workflow/approve?problemId=prob_saved_views", { orgId: "org_northstar", key: "approve_other" }));
    expect(other.status).toBeGreaterThanOrEqual(400);
    const own = await approve(request("/api/workflow/approve?problemId=prob_export", { orgId: "org_northstar", key: "approve_own" }));
    expect(own.status).toBe(200);
    expect((await own.json()).state.approval.problemId).toBe("prob_export");
  });

  it("reads one issue's workflow and rejects malformed issue ids", async () => {
    const read = (query: string) => readState(new NextRequest(`http://localhost/api/workflow/state${query}`, { headers: { "x-org-id": "org_northstar" } }));
    expect((await read("?problemId=prob_export")).status).toBe(200);
    expect((await read("?problemId=prob_saved_views")).status).toBe(404);
    expect((await read("?problemId=..%2Fother")).status).toBe(400);
  });

  it("advances only after approval", async () => {
    const blocked = await advance(request("/api/workflow/advance", { orgId: "org_northstar", key: "advance_001" }));
    expect(blocked.status).toBe(409);
    await approve(request("/api/workflow/approve", { orgId: "org_northstar", key: "approve_001" }));
    const response = await advance(request("/api/workflow/advance", { orgId: "org_northstar", key: "advance_001" }));
    expect((await response.json()).state.problemStage).toBe("Planned");
  });

  it("requires an authenticated session in production", async () => {
    process.env.APP_MODE = "production";
    const response = await approve(request("/api/workflow/approve", { authenticated:false, orgId: "org_northstar", key: "approve_001" }));
    expect(response.status).toBe(401);
    process.env.APP_MODE = "demo";
  });

  it("requires an administrator role for credential mutations", async () => {
    const secured = request("/api/ai/config", {
      orgId:"org_northstar",
      key:"admin_guard_001",
      role:"Contributor",
    });
    await expect(authorizeAdminMutation(secured)).rejects.toThrow(
      "Administrator permission is required",
    );
  });

  it("prevents viewers from mutating workflow state", async () => {
    const response = await approve(request("/api/workflow/approve", {
      orgId:"org_northstar",
      key:"viewer_guard_001",
      role:"Viewer",
    }));
    expect(response.status).toBe(403);
  });

  it("fails clearly without exposing a placeholder AI result when no provider is configured", async () => {
    const response = await analyze(request("/api/ai/analyze", { orgId:"org_northstar", key:"openai_test_001" }));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error:"OpenAI is not configured. Add its API key in Settings." });
  });
});
