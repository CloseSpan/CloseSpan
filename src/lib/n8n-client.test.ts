import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  N8nConfigurationError,
  normalizeN8nConfiguration,
  testN8nConnection,
  testN8nWorkflowEndpoint,
  triggerN8nFeedbackPull,
} from "./n8n-client";

describe("n8n client", () => {
  it("requires secure same-origin API and webhook URLs", () => {
    expect(() => normalizeN8nConfiguration({
      baseUrl: "https://workspace.app.n8n.cloud",
      triggerUrl: "https://attacker.example/webhook/closespan",
    })).toThrow(N8nConfigurationError);
    expect(normalizeN8nConfiguration({
      baseUrl: "https://workspace.app.n8n.cloud",
      triggerUrl: "https://workspace.app.n8n.cloud/webhook/closespan",
    })).toEqual({
      baseUrl: "https://workspace.app.n8n.cloud",
      triggerUrl: "https://workspace.app.n8n.cloud/webhook/closespan",
    });
  });

  it("verifies the production webhook with a signed dry-run handshake", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ accepted: true }),
      { status: 200, headers: { "content-type": "application/json" } },
    ));

    await testN8nWorkflowEndpoint({
      baseUrl: "https://workspace.app.n8n.cloud",
      triggerUrl: "https://workspace.app.n8n.cloud/webhook/closespan",
      signingSecret: "signing_secret",
      fetchImpl,
    });

    const [, request] = fetchImpl.mock.calls[0] as [URL, RequestInit];
    const body = String(request.body);
    expect(JSON.parse(body)).toMatchObject({
      event: "connection.test",
      dryRun: true,
    });
    expect((request.headers as Record<string, string>)["x-closespan-signature"]).toBe(
      `sha256=${createHmac("sha256", "signing_secret").update(body).digest("hex")}`,
    );
  });

  it("verifies the API using the n8n API-key header", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ data: [] }),
      { status: 200, headers: { "content-type": "application/json" } },
    ));

    await testN8nConnection({
      baseUrl: "https://workspace.app.n8n.cloud",
      apiKey: "secret_api_key",
      fetchImpl,
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      new URL("https://workspace.app.n8n.cloud/api/v1/workflows?limit=1"),
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({ "X-N8N-API-KEY": "secret_api_key" }),
      }),
    );
  });

  it("signs workflow triggers and never sends the API key to the webhook", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ executionId: "run_42", message: "Queued" }),
      { status: 200, headers: { "content-type": "application/json" } },
    ));
    const result = await triggerN8nFeedbackPull({
      baseUrl: "https://workspace.app.n8n.cloud",
      triggerUrl: "https://workspace.app.n8n.cloud/webhook/closespan",
      signingSecret: "signing_secret",
      orgId: "org_test",
      actorId: "user_test",
      actorName: "Test Admin",
      traceId: "trace_test",
      integrationIds: ["int_discord"],
      accountIds: ["guild_42"],
      fetchImpl,
    });

    const [, request] = fetchImpl.mock.calls[0] as [URL, RequestInit];
    const body = String(request.body);
    const headers = request.headers as Record<string, string>;
    expect(headers).not.toHaveProperty("X-N8N-API-KEY");
    expect(headers["x-closespan-signature"]).toBe(
      `sha256=${createHmac("sha256", "signing_secret").update(body).digest("hex")}`,
    );
    expect(JSON.parse(body)).toMatchObject({
      event: "feedback.pull.requested",
      organizationId: "org_test",
      selection: {
        mode: "selected",
        integrationIds: ["int_discord"],
        accountIds: ["guild_42"],
      },
    });
    expect(result).toMatchObject({ accepted: true, executionId: "run_42", message: "Queued" });
  });
});
