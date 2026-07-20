import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getWorkspaceSetupStatus } from "./integration-repository";
import {
  createNangoConnectionAttempt,
  markNangoConnectionNeedsReconnect,
  NANGO_TAGS,
  type NangoConnectionAttempt,
  reconcileNangoAuthEvent,
  resetNangoMemoryState,
} from "./nango-repository";

function tags(attempt: NangoConnectionAttempt): Record<string, string> {
  return {
    [NANGO_TAGS.attemptId]: attempt.id,
    [NANGO_TAGS.integrationId]: attempt.integrationId,
    [NANGO_TAGS.organizationId]: attempt.orgId,
    [NANGO_TAGS.endUserId]: `${attempt.orgId}:${attempt.actorId}`,
    [NANGO_TAGS.endUserEmail]: attempt.actorEmail,
    [NANGO_TAGS.endUserDisplayName]: attempt.actorName,
  };
}

async function connect(input: {
  orgId: string;
  integrationId: string;
  providerConfigKey: string;
  connectionId: string;
}): Promise<NangoConnectionAttempt> {
  const attempt = await createNangoConnectionAttempt({
    orgId: input.orgId,
    integrationId: input.integrationId,
    providerConfigKey: input.providerConfigKey,
    nangoEnvironment: "DEV",
    actorId: `admin_${input.orgId}`,
    actorName: `Admin ${input.orgId}`,
    actorEmail: `admin+${input.orgId}@example.com`,
    idempotencyKey: `nango_${input.orgId}_${input.integrationId}`,
    traceId: `trace_${input.orgId}_${input.integrationId}`,
    expiresAt: new Date(Date.now() + 60_000),
  });
  const result = await reconcileNangoAuthEvent({
    payloadHash: `${input.orgId}_${input.integrationId}`
      .padEnd(64, "0")
      .slice(0, 64),
    operation: "creation",
    providerConfigKey: input.providerConfigKey,
    connectionId: input.connectionId,
    provider: input.providerConfigKey,
    nangoEnvironment: "DEV",
    tags: tags(attempt),
  });
  expect(result).toBe("processed");
  return attempt;
}

describe("workspace setup status from Nango connections", () => {
  beforeEach(() => {
    process.env.PERSISTENCE_MODE = "memory";
    process.env.APP_MODE = "demo";
    resetNangoMemoryState();
  });

  afterEach(() => {
    resetNangoMemoryState();
    delete process.env.PERSISTENCE_MODE;
    delete process.env.APP_MODE;
  });

  it("returns only this tenant's connected integration IDs", async () => {
    await connect({
      orgId: "org_alpha",
      integrationId: "int_zendesk",
      providerConfigKey: "zendesk",
      connectionId: "alpha_zendesk",
    });
    await connect({
      orgId: "org_alpha",
      integrationId: "int_github",
      providerConfigKey: "github-getting-started",
      connectionId: "alpha_github",
    });
    await connect({
      orgId: "org_beta",
      integrationId: "int_slack",
      providerConfigKey: "slack",
      connectionId: "beta_slack",
    });

    const alpha = await getWorkspaceSetupStatus("org_alpha");
    const beta = await getWorkspaceSetupStatus("org_beta");

    expect(alpha.connectedIntegrationIds.sort()).toEqual([
      "int_github",
      "int_zendesk",
    ]);
    expect(alpha.feedbackConnected).toBe(true);
    expect(alpha.githubConnected).toBe(true);
    expect(beta.connectedIntegrationIds).toEqual(["int_slack"]);
    expect(beta.feedbackConnected).toBe(true);
    expect(beta.githubConnected).toBe(false);
  });

  it("removes a connection needing reauthorization from setup completion", async () => {
    await connect({
      orgId: "org_alpha",
      integrationId: "int_zendesk",
      providerConfigKey: "zendesk",
      connectionId: "alpha_zendesk",
    });
    await connect({
      orgId: "org_alpha",
      integrationId: "int_github",
      providerConfigKey: "github-getting-started",
      connectionId: "alpha_github",
    });

    expect(
      await markNangoConnectionNeedsReconnect({
        payloadHash: "github_refresh_failure".padEnd(64, "0"),
        providerConfigKey: "github-getting-started",
        connectionId: "alpha_github",
        nangoEnvironment: "DEV",
      }),
    ).toBe("processed");

    const status = await getWorkspaceSetupStatus("org_alpha");
    expect(status.connectedIntegrationIds).toEqual(["int_zendesk"]);
    expect(status.feedbackConnected).toBe(true);
    expect(status.githubConnected).toBe(false);
    expect(status.setupComplete).toBe(false);
  });
});
