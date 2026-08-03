import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const pipedream = vi.hoisted(() => ({
  listAccounts: vi.fn(),
}));

const repository = vi.hoisted(() => ({
  listConnections: vi.fn(),
  reconcileAccounts: vi.fn(),
  saveAccount: vi.fn(),
}));

const slack = vi.hoisted(() => ({
  ensureIntake: vi.fn(),
}));

vi.mock("@/lib/pipedream", () => ({
  getPipedreamClient: () => ({
    accounts: { list: pipedream.listAccounts },
  }),
  pipedreamExternalUserId: (orgId: string) => `feelow:${orgId}`,
}));

vi.mock("@/lib/pipedream-repository", () => ({
  listPipedreamConnections: repository.listConnections,
  reconcilePipedreamAccounts: repository.reconcileAccounts,
  savePipedreamAccount: repository.saveAccount,
}));

vi.mock("@/lib/slack-intake", () => ({
  ensureSlackIntakeChannel: slack.ensureIntake,
}));

import { POST } from "./route";

function accountPage(accounts: unknown[]) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const account of accounts) yield account;
    },
  };
}

function statusRequest(
  options: {
    authenticated?: boolean;
    idempotencyKey?: string | null;
    organizationHeader?: string;
    role?: string;
    integrationId?: "int_zendesk" | "int_slack";
  } = {},
) {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-test-user-id": "status_route_admin",
    "x-test-user-org-id": "org_alpha",
    "x-test-user-role": options.role ?? "Admin",
  };
  if (options.authenticated === false) headers["x-test-auth"] = "none";
  if (options.organizationHeader) headers["x-org-id"] = options.organizationHeader;
  if (options.idempotencyKey !== null) {
    headers["idempotency-key"] =
      options.idempotencyKey ?? "status_refresh_001";
  }

  return new NextRequest(
    "http://localhost/api/integrations/pipedream/status",
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        integrationId: options.integrationId ?? "int_zendesk",
      }),
    },
  );
}

describe("Pipedream connection status route security", () => {
  beforeEach(() => {
    process.env.APP_MODE = "demo";
    pipedream.listAccounts.mockReset().mockResolvedValue(
      accountPage([
        {
          id: "apn_alpha_zendesk",
          app: { nameSlug: "zendesk" },
          name: "Alpha Support",
          healthy: true,
          authorizedScopes: ["read"],
        },
      ]),
    );
    repository.saveAccount.mockReset().mockResolvedValue(undefined);
    repository.reconcileAccounts.mockReset().mockResolvedValue(undefined);
    repository.listConnections.mockReset().mockResolvedValue([
      {
        integrationId: "int_zendesk",
        accountId: "apn_alpha_zendesk",
        state: "Connected",
      },
    ]);
    slack.ensureIntake.mockReset().mockResolvedValue({
      state: "Connected",
      accountId: "apn_alpha_slack",
      teamId: "T_ALPHA",
      teamName: "Alpha",
      channelId: "C_FEEDBACK",
      channelName: "closespan-feedback",
      lastPolledAt: null,
      lastError: null,
    });
  });

  it("refreshes and persists accounts only for the authenticated organization", async () => {
    const response = await POST(statusRequest());

    expect(response.status).toBe(200);
    expect(pipedream.listAccounts).toHaveBeenCalledWith({
      externalUserId: "feelow:org_alpha",
      app: "zendesk",
      limit: 100,
    });
    expect(repository.saveAccount).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: "org_alpha",
        integrationId: "int_zendesk",
        externalUserId: "feelow:org_alpha",
        actorId: "status_route_admin",
        account: expect.objectContaining({ id: "apn_alpha_zendesk" }),
      }),
    );
    expect(repository.reconcileAccounts).toHaveBeenCalledWith({
      orgId: "org_alpha",
      integrationId: "int_zendesk",
      upstreamAccountIds: ["apn_alpha_zendesk"],
      verifiedBefore: expect.any(Date),
    });
    expect(repository.listConnections).toHaveBeenCalledWith("org_alpha");
    expect(await response.json()).toMatchObject({
      integrationId: "int_zendesk",
      connectionState: "Connected",
    });
  });

  it("consumes every paginated account before reconciling missing bindings", async () => {
    pipedream.listAccounts.mockResolvedValue(
      accountPage([
        {
          id: "apn_alpha_page_1",
          app: { nameSlug: "zendesk" },
          healthy: true,
        },
        {
          id: "apn_alpha_page_2",
          app: { nameSlug: "zendesk" },
          healthy: true,
        },
      ]),
    );
    repository.listConnections.mockResolvedValue([]);

    const response = await POST(statusRequest());

    expect(response.status).toBe(200);
    expect(repository.saveAccount).toHaveBeenCalledTimes(2);
    expect(repository.reconcileAccounts).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: "org_alpha",
        integrationId: "int_zendesk",
        upstreamAccountIds: ["apn_alpha_page_1", "apn_alpha_page_2"],
      }),
    );
    expect(
      repository.reconcileAccounts.mock.invocationCallOrder[0],
    ).toBeGreaterThan(repository.saveAccount.mock.invocationCallOrder[1]);
  });

  it("reconciles all local bindings when the complete upstream list is empty", async () => {
    pipedream.listAccounts.mockResolvedValue(accountPage([]));
    repository.listConnections.mockResolvedValue([]);

    const response = await POST(statusRequest());

    expect(response.status).toBe(200);
    expect(repository.saveAccount).not.toHaveBeenCalled();
    expect(repository.reconcileAccounts).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: "org_alpha",
        integrationId: "int_zendesk",
        upstreamAccountIds: [],
      }),
    );
    expect(await response.json()).toMatchObject({
      connectionState: "Disconnected",
      accounts: [],
    });
  });

  it("automatically provisions the Slack intake channel after connection", async () => {
    pipedream.listAccounts.mockResolvedValue(
      accountPage([
        {
          id: "apn_alpha_slack",
          app: { nameSlug: "slack" },
          name: "Alpha Slack",
          healthy: true,
          authorizedScopes: ["channels:read", "channels:write"],
        },
      ]),
    );
    repository.listConnections.mockResolvedValue([
      {
        integrationId: "int_slack",
        accountId: "apn_alpha_slack",
        state: "Connected",
      },
    ]);

    const response = await POST(
      statusRequest({ integrationId: "int_slack" }),
    );

    expect(response.status).toBe(200);
    expect(slack.ensureIntake).toHaveBeenCalledWith({
      orgId: "org_alpha",
      accountId: "apn_alpha_slack",
      actorId: "status_route_admin",
      actorName: "Avery Chen",
      traceId: expect.stringContaining(":slack-intake"),
    });
    expect(await response.json()).toMatchObject({
      connectionState: "Connected",
      slackIntake: {
        channelName: "closespan-feedback",
        state: "Connected",
      },
      slackSetupWarning: null,
    });
  });

  it("requires an authenticated administrator before contacting Pipedream", async () => {
    expect(
      (await POST(statusRequest({ authenticated: false }))).status,
    ).toBe(401);
    expect(
      (await POST(statusRequest({ role: "Contributor" }))).status,
    ).toBe(403);
    expect(pipedream.listAccounts).not.toHaveBeenCalled();
    expect(repository.saveAccount).not.toHaveBeenCalled();
    expect(repository.reconcileAccounts).not.toHaveBeenCalled();
  });

  it("requires an idempotency key before contacting Pipedream", async () => {
    const response = await POST(statusRequest({ idempotencyKey: null }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "A valid idempotency key is required",
    });
    expect(pipedream.listAccounts).not.toHaveBeenCalled();
    expect(repository.saveAccount).not.toHaveBeenCalled();
    expect(repository.reconcileAccounts).not.toHaveBeenCalled();
  });

  it("rejects a caller-selected organization scope", async () => {
    const response = await POST(
      statusRequest({ organizationHeader: "org_other" }),
    );

    expect(response.status).toBe(403);
    expect(pipedream.listAccounts).not.toHaveBeenCalled();
    expect(repository.saveAccount).not.toHaveBeenCalled();
    expect(repository.reconcileAccounts).not.toHaveBeenCalled();
    expect(repository.listConnections).not.toHaveBeenCalled();
  });
});
