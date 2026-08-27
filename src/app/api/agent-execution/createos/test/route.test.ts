import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const createos = vi.hoisted(() => ({ run: vi.fn() }));

vi.mock("@/lib/createos-sandbox-check", async (importOriginal) => {
  const original = await importOriginal<
    typeof import("@/lib/createos-sandbox-check")
  >();
  return { ...original, runCreateosSandboxCheck: createos.run };
});

import { CreateosSandboxCheckError } from "@/lib/createos-sandbox-check";
import { POST } from "./route";

function request(options: { role?: string; authenticated?: boolean } = {}) {
  return new NextRequest(
    "http://localhost/api/agent-execution/createos/test",
    {
      method: "POST",
      headers: {
        origin: "http://localhost",
        "idempotency-key": `createos_${crypto.randomUUID().replaceAll("-", "")}`,
        "x-request-id": crypto.randomUUID(),
        "x-test-auth": options.authenticated === false ? "none" : "user",
        "x-test-user-id": "user_alpha",
        "x-test-user-org-id": "org_alpha",
        "x-test-user-role": options.role ?? "Admin",
      },
    },
  );
}

describe("CreateOS sandbox test route", () => {
  beforeEach(() => {
    createos.run.mockReset().mockResolvedValue({
      status: "ok",
      provider: "CreateOS Sandbox",
      sandboxId: "sandbox_test",
      executionDurationMs: 20,
      totalDurationMs: 200,
      checkedAt: "2026-08-26T12:00:00.000Z",
    });
  });

  it("allows an authenticated administrator to run the fixed check", async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(await response.json()).toMatchObject({
      status: "ok",
      provider: "CreateOS Sandbox",
      sandboxId: "sandbox_test",
    });
    expect(createos.run).toHaveBeenCalledOnce();
  });

  it("rejects unauthenticated and non-administrator requests", async () => {
    expect((await POST(request({ authenticated: false }))).status).toBe(401);
    expect((await POST(request({ role: "Contributor" }))).status).toBe(403);
    expect(createos.run).not.toHaveBeenCalled();
  });

  it("returns a sanitized timeout response", async () => {
    createos.run.mockRejectedValue(
      new CreateosSandboxCheckError(
        "timeout",
        "The CreateOS sandbox did not become ready in time.",
      ),
    );
    const response = await POST(request());
    const body = await response.json();

    expect(response.status).toBe(504);
    expect(body).toMatchObject({
      status: "failed",
      code: "timeout",
      error: "The CreateOS sandbox did not become ready in time.",
    });
    expect(JSON.stringify(body)).not.toContain("createos_test");
  });
});
