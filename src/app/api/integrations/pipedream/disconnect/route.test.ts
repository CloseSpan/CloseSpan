import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const provider = vi.hoisted(() => ({
  deleteAccount: vi.fn(),
}));

const repository = vi.hoisted(() => ({
  disconnectAccount: vi.fn(),
  getConnection: vi.fn(),
}));

vi.mock("@/lib/pipedream", () => ({
  getPipedreamClient: () => ({
    accounts: { delete: provider.deleteAccount },
  }),
}));

vi.mock("@/lib/pipedream-repository", () => ({
  disconnectPipedreamAccount: repository.disconnectAccount,
  getPipedreamConnection: repository.getConnection,
}));

import { POST } from "./route";

function request() {
  return new NextRequest(
    "http://localhost/api/integrations/pipedream/disconnect",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": "disconnect_account_001",
        "x-test-user-id": "disconnect_admin",
        "x-test-user-org-id": "org_alpha",
        "x-test-user-role": "Admin",
      },
      body: JSON.stringify({
        integrationId: "int_zendesk",
        accountId: "apn_alpha_zendesk",
      }),
    },
  );
}

describe("Pipedream account disconnect", () => {
  beforeEach(() => {
    process.env.APP_MODE = "demo";
    provider.deleteAccount.mockReset().mockResolvedValue(undefined);
    repository.getConnection.mockReset().mockResolvedValue({
      integrationId: "int_zendesk",
      accountId: "apn_alpha_zendesk",
      state: "Connected",
    });
    repository.disconnectAccount.mockReset().mockResolvedValue(true);
  });

  it("deletes the provider account before clearing the tenant binding", async () => {
    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(provider.deleteAccount).toHaveBeenCalledWith("apn_alpha_zendesk");
    expect(repository.disconnectAccount).toHaveBeenCalledWith({
      orgId: "org_alpha",
      integrationId: "int_zendesk",
      accountId: "apn_alpha_zendesk",
    });
    expect(repository.disconnectAccount.mock.invocationCallOrder[0]).toBeGreaterThan(
      provider.deleteAccount.mock.invocationCallOrder[0],
    );
  });

  it("treats a provider 404 as already disconnected and still clears local state", async () => {
    provider.deleteAccount.mockRejectedValue({ statusCode: 404 });

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ disconnected: true });
    expect(repository.disconnectAccount).toHaveBeenCalledWith({
      orgId: "org_alpha",
      integrationId: "int_zendesk",
      accountId: "apn_alpha_zendesk",
    });
  });

  it("retains the local binding when the provider failure is not a confirmed deletion", async () => {
    provider.deleteAccount.mockRejectedValue({ statusCode: 502 });

    const response = await POST(request());

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "This account could not be removed right now.",
    });
    expect(repository.disconnectAccount).not.toHaveBeenCalled();
  });

  it("is idempotent when the tenant binding is already absent", async () => {
    repository.getConnection.mockResolvedValue(null);

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(provider.deleteAccount).not.toHaveBeenCalled();
    expect(repository.disconnectAccount).not.toHaveBeenCalled();
  });
});
