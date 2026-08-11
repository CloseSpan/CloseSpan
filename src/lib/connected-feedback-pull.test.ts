import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PipedreamConnection } from "./pipedream-repository";

const dependencies = vi.hoisted(() => ({
  listConnections: vi.fn(),
  pullPipedream: vi.fn(),
  supportsManual: vi.fn(),
  ensureSlack: vi.fn(),
  syncSlack: vi.fn(),
  analyzeSlack: vi.fn(),
  reconcileSlack: vi.fn(),
  deliverSlack: vi.fn(),
  runAutomation: vi.fn(),
}));

vi.mock("./pipedream-repository", () => ({
  listPipedreamConnections: dependencies.listConnections,
}));

vi.mock("./pipedream-feedback-import", () => ({
  pullPipedreamFeedback: dependencies.pullPipedream,
  supportsManualFeedbackImport: dependencies.supportsManual,
}));

vi.mock("./slack-intake", () => ({
  ensureSlackIntakeChannel: dependencies.ensureSlack,
  syncSlackIntake: dependencies.syncSlack,
  analyzeAndClusterSlackSignals: dependencies.analyzeSlack,
  reconcileSlackNotifications: dependencies.reconcileSlack,
  deliverSlackNotifications: dependencies.deliverSlack,
}));

vi.mock("./problem-automation-repository", () => ({
  runProblemAutomationTick: dependencies.runAutomation,
}));

import {
  listConnectedFeedbackSources,
  pullConnectedFeedbackSources,
} from "./connected-feedback-pull";

function connection(
  integrationId: PipedreamConnection["integrationId"],
  accountId: string,
): PipedreamConnection {
  return {
    integrationId,
    accountId,
    appSlug: integrationId.replace("int_", ""),
    accountName: `${integrationId} account`,
    state: "Connected",
    healthy: true,
    authorizedScopes: [],
    lastImportAt: null,
    lastImportStatus: null,
    lastImportCount: 0,
    lastImportError: null,
    importCursor: null,
  };
}

const context = {
  orgId: "org_test",
  actorId: "user_test",
  actorName: "Test Admin",
  traceId: "trace_test",
};

describe("connected feedback pull", () => {
  beforeEach(() => {
    dependencies.listConnections.mockReset().mockResolvedValue([]);
    dependencies.pullPipedream.mockReset();
    dependencies.supportsManual.mockReset().mockImplementation(
      (integrationId: string) => integrationId === "int_zendesk",
    );
    dependencies.ensureSlack.mockReset().mockResolvedValue({ state: "Connected" });
    dependencies.syncSlack.mockReset().mockResolvedValue({ fetched: 2, created: 2, updated: 0 });
    dependencies.analyzeSlack.mockReset().mockResolvedValue({ analyzed: 2, clustered: 1 });
    dependencies.reconcileSlack.mockReset().mockResolvedValue(undefined);
    dependencies.deliverSlack.mockReset().mockResolvedValue({ sent: 0, failed: 0 });
    dependencies.runAutomation.mockReset().mockResolvedValue({ moved: false });
  });

  it("pulls Slack through its native intake and intelligence pipeline", async () => {
    dependencies.listConnections.mockResolvedValue([
      connection("int_slack", "apn_slack"),
    ]);

    const result = await pullConnectedFeedbackSources(context);

    expect(dependencies.ensureSlack).toHaveBeenCalledWith({
      orgId: "org_test",
      accountId: "apn_slack",
      actorId: "user_test",
      actorName: "Test Admin",
      traceId: "trace_test:slack-intake",
    });
    expect(dependencies.syncSlack).toHaveBeenCalledWith("org_test");
    expect(dependencies.runAutomation).toHaveBeenCalledWith("org_test");
    expect(result).toMatchObject({ connectedSources: 1, succeeded: 1, failed: 0 });
    expect(result.results[0]).toMatchObject({
      provider: "Slack",
      status: "succeeded",
      fetched: 2,
      created: 2,
      analyzed: 2,
      clustered: 1,
    });
  });

  it("lists distinct connected sources for the source chooser", async () => {
    dependencies.listConnections.mockResolvedValue([
      connection("int_zendesk", "apn_zendesk_one"),
      connection("int_zendesk", "apn_zendesk_two"),
      connection("int_slack", "apn_slack"),
    ]);

    await expect(listConnectedFeedbackSources("org_test")).resolves.toEqual([
      {
        integrationId: "int_zendesk",
        provider: "Zendesk",
        accountCount: 2,
        manualPullAvailable: true,
      },
      {
        integrationId: "int_slack",
        provider: "Slack",
        accountCount: 1,
        manualPullAvailable: true,
      },
    ]);
  });

  it("pulls every supported connected account and reports each source", async () => {
    dependencies.listConnections.mockResolvedValue([
      connection("int_slack", "apn_slack"),
      connection("int_zendesk", "apn_zendesk"),
    ]);
    dependencies.pullPipedream.mockResolvedValue({
      integrationId: "int_zendesk",
      accountId: "apn_zendesk",
      accountName: "Support",
      fetched: 4,
      created: 3,
      updated: 1,
      skipped: 0,
    });

    const result = await pullConnectedFeedbackSources(context);

    expect(result.connectedSources).toBe(2);
    expect(result.succeeded).toBe(2);
    expect(result.results.map((item) => item.provider)).toEqual(["Slack", "Zendesk"]);
    expect(dependencies.pullPipedream).toHaveBeenCalledWith({
      orgId: "org_test",
      integrationId: "int_zendesk",
      accountId: "apn_zendesk",
    });
  });

  it("reports connected sources whose importer is not implemented", async () => {
    dependencies.listConnections.mockResolvedValue([
      connection("int_intercom", "apn_intercom"),
    ]);

    const result = await pullConnectedFeedbackSources(context);

    expect(result).toMatchObject({ connectedSources: 1, succeeded: 0, unsupported: 1 });
    expect(result.results[0]).toMatchObject({
      provider: "Intercom",
      status: "unsupported",
    });
  });

  it("isolates a source failure so other connected sources still complete", async () => {
    dependencies.listConnections.mockResolvedValue([
      connection("int_slack", "apn_slack"),
      connection("int_zendesk", "apn_zendesk"),
    ]);
    dependencies.syncSlack.mockRejectedValue(new Error("provider secret"));
    dependencies.pullPipedream.mockResolvedValue({
      integrationId: "int_zendesk",
      accountId: "apn_zendesk",
      accountName: "Support",
      fetched: 1,
      created: 1,
      updated: 0,
      skipped: 0,
    });

    const result = await pullConnectedFeedbackSources(context);

    expect(result).toMatchObject({ succeeded: 1, failed: 1 });
    expect(result.results.find((item) => item.provider === "Slack")).toMatchObject({
      status: "failed",
      message: "Slack could not be pulled. Retry shortly or reconnect the account.",
    });
  });

  it("pulls only the source selected by the user", async () => {
    dependencies.listConnections.mockResolvedValue([
      connection("int_slack", "apn_slack"),
      connection("int_zendesk", "apn_zendesk"),
    ]);
    dependencies.pullPipedream.mockResolvedValue({
      integrationId: "int_zendesk",
      accountId: "apn_zendesk",
      accountName: "Support",
      fetched: 1,
      created: 1,
      updated: 0,
      skipped: 0,
    });

    const result = await pullConnectedFeedbackSources(
      context,
      ["int_zendesk"],
    );

    expect(result.results.map((item) => item.provider)).toEqual(["Zendesk"]);
    expect(dependencies.syncSlack).not.toHaveBeenCalled();
  });

  it("ignores connected engineering destinations", async () => {
    dependencies.listConnections.mockResolvedValue([
      connection("int_linear", "apn_linear"),
    ]);

    const result = await pullConnectedFeedbackSources(context);

    expect(result).toEqual({
      results: [],
      connectedSources: 0,
      succeeded: 0,
      failed: 0,
      unsupported: 0,
    });
  });
});
