import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const coordinator = vi.hoisted(() => ({ pull: vi.fn(), list: vi.fn() }));

vi.mock("@/lib/connected-feedback-pull", () => ({
  CONNECTED_FEEDBACK_SOURCE_IDS: [
    "int_zendesk",
    "int_intercom",
    "int_slack",
    "int_app_store",
    "int_play_store",
    "int_linear",
    "int_jira",
    "int_sentry",
    "int_posthog",
    "int_discord",
  ],
  pullConnectedFeedbackSources: coordinator.pull,
  listConnectedFeedbackSources: coordinator.list,
}));

import { GET, POST } from "./route";

function request(options: { role?: string; orgId?: string } = {}) {
  return new NextRequest("http://localhost/api/integrations/pull", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": `pull_${crypto.randomUUID()}`,
      "x-test-user-role": options.role ?? "Admin",
      ...(options.orgId ? { "x-org-id": options.orgId } : {}),
    },
    body: JSON.stringify({}),
  });
}

function readRequest(options: { role?: string; orgId?: string } = {}) {
  return new NextRequest("http://localhost/api/integrations/pull", {
    headers: {
      "x-test-user-role": options.role ?? "Admin",
      ...(options.orgId ? { "x-org-id": options.orgId } : {}),
    },
  });
}

describe("connected feedback pull route", () => {
  beforeEach(() => {
    process.env.APP_MODE = "demo";
    coordinator.list.mockReset().mockResolvedValue([
      { integrationId: "int_slack", provider: "Slack", accountCount: 1, manualPullAvailable: true },
    ]);
    coordinator.pull.mockReset().mockResolvedValue({
      results: [{ provider: "Slack", status: "succeeded", fetched: 1, created: 1, updated: 0 }],
      connectedSources: 1,
      succeeded: 1,
      failed: 0,
      unsupported: 0,
      orchestrationProvider: "pipedream",
      routed: false,
    });
  });

  it("pulls the authenticated workspace's connected feedback sources", async () => {
    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(coordinator.pull).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: "org_northstar",
        actorId: "demo_user_avery",
      }),
      undefined,
      undefined,
    );
    await expect(response.json()).resolves.toMatchObject({
      connectedSources: 1,
      succeeded: 1,
    });
  });

  it("lists connected sources for the chooser", async () => {
    const response = await GET(readRequest());

    expect(response.status).toBe(200);
    expect(coordinator.list).toHaveBeenCalledWith("org_northstar");
    await expect(response.json()).resolves.toMatchObject({
      sources: [{ integrationId: "int_slack", provider: "Slack" }],
    });
  });

  it("passes an individual source selection to the coordinator", async () => {
    const selected = request();
    const response = await POST(new NextRequest(selected.url, {
      method: "POST",
      headers: selected.headers,
      body: JSON.stringify({ integrationIds: ["int_slack"] }),
    }));

    expect(response.status).toBe(200);
    expect(coordinator.pull).toHaveBeenCalledWith(
      expect.any(Object),
      ["int_slack"],
      undefined,
    );
  });

  it("accepts Discord as an n8n collection target", async () => {
    const selected = request();
    const response = await POST(new NextRequest(selected.url, {
      method: "POST",
      headers: selected.headers,
      body: JSON.stringify({ integrationIds: ["int_discord"] }),
    }));

    expect(response.status).toBe(200);
    expect(coordinator.pull).toHaveBeenCalledWith(
      expect.any(Object),
      ["int_discord"],
      undefined,
    );
  });

  it("passes an account-level selection without bypassing orchestration", async () => {
    const selected = request();
    const response = await POST(new NextRequest(selected.url, {
      method: "POST",
      headers: selected.headers,
      body: JSON.stringify({
        integrationIds: ["int_zendesk"],
        accountIds: ["apn_zendesk"],
      }),
    }));

    expect(response.status).toBe(200);
    expect(coordinator.pull).toHaveBeenCalledWith(
      expect.any(Object),
      ["int_zendesk"],
      ["apn_zendesk"],
    );
  });

  it("requires an administrator and enforces workspace scope", async () => {
    expect((await POST(request({ role: "Contributor" }))).status).toBe(403);
    expect((await POST(request({ orgId: "org_other" }))).status).toBe(403);
    expect(coordinator.pull).not.toHaveBeenCalled();
  });

  it("explains when no connected feedback source can be pulled", async () => {
    coordinator.pull.mockResolvedValue({
      results: [],
      connectedSources: 0,
      succeeded: 0,
      failed: 0,
      unsupported: 0,
      orchestrationProvider: "pipedream",
      routed: false,
    });

    const response = await POST(request());

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "Connect a feedback source before pulling feedback.",
    });
  });

  it("accepts an n8n-routed pull before an asynchronous import is returned", async () => {
    coordinator.pull.mockResolvedValue({
      results: [],
      connectedSources: 0,
      succeeded: 0,
      failed: 0,
      unsupported: 0,
      orchestrationProvider: "n8n",
      routed: true,
      message: "n8n accepted the feedback collection request.",
    });

    const response = await POST(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      orchestrationProvider: "n8n",
      routed: true,
    });
  });

  it("does not expose internal failures", async () => {
    coordinator.pull.mockRejectedValue(new Error("database connection string"));

    const response = await POST(request());

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: "Connected feedback sources could not be checked right now. Retry shortly.",
    });
  });
});
