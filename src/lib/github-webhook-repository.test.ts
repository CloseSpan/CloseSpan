import { beforeEach, describe, expect, it, vi } from "vitest";

const database = vi.hoisted(() => ({
  client: { query: vi.fn() },
  pool: { query: vi.fn() },
  transaction: vi.fn(),
}));
const github = vi.hoisted(() => ({ verify: vi.fn() }));
const installation = vi.hoisted(() => ({ sync: vi.fn() }));

vi.mock("./db", () => ({
  databasePool: () => database.pool,
  transaction: database.transaction,
}));
vi.mock("./github-app-auth", () => ({ verifyGithubInstallation: github.verify }));
vi.mock("./github-installation-repository", () => ({
  syncGithubInstallationRecords: installation.sync,
}));

import { processGithubWebhook } from "./github-webhook-repository";

const deliveryId = "11111111-1111-4111-8111-111111111111";

function sql(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ") : "";
}

describe("GitHub webhook persistence", () => {
  beforeEach(() => {
    database.pool.query.mockReset().mockResolvedValue({ rows: [], rowCount: 0 });
    database.client.query.mockReset().mockImplementation(async (query: unknown) => {
      if (sql(query).includes("INSERT INTO github_webhook_deliveries"))
        return { rows: [{ delivery_id: deliveryId }], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    });
    database.transaction.mockReset().mockImplementation(
      async (work: (client: typeof database.client) => Promise<unknown>) => work(database.client),
    );
    github.verify.mockReset();
    installation.sync.mockReset().mockResolvedValue(undefined);
  });

  it("acknowledges ping without tenant side effects", async () => {
    await expect(processGithubWebhook({
      deliveryId,
      event: "ping",
      rawBody: '{"zen":"hello"}',
      payload: {},
    })).resolves.toEqual({ accepted: true, duplicate: false, outcome: "ping_acknowledged" });
    expect(database.pool.query).toHaveBeenCalledTimes(1);
    expect(github.verify).not.toHaveBeenCalled();
  });

  it("deduplicates a repeated GitHub delivery", async () => {
    database.pool.query.mockResolvedValue({ rows: [{ exists: 1 }], rowCount: 1 });
    await expect(processGithubWebhook({
      deliveryId,
      event: "ping",
      rawBody: "{}",
      payload: {},
    })).resolves.toEqual({ accepted: true, duplicate: true, outcome: "duplicate" });
    expect(database.client.query).not.toHaveBeenCalled();
  });

  it("ignores an installation that was never bound through the signed callback", async () => {
    await expect(processGithubWebhook({
      deliveryId,
      event: "installation",
      rawBody: '{"action":"created","installation":{"id":150109806}}',
      payload: { action: "created", installation: { id: 150109806 } },
    })).resolves.toMatchObject({ outcome: "ignored_unbound_installation" });
    expect(github.verify).not.toHaveBeenCalled();
    expect(installation.sync).not.toHaveBeenCalled();
  });

  it("resynchronizes a previously bound installation from GitHub, not the payload", async () => {
    database.pool.query.mockImplementation(async (query: unknown) =>
      sql(query).includes("FROM github_webhook_deliveries")
        ? { rows: [], rowCount: 0 }
        : { rows: [{ org_id: "org-1" }], rowCount: 1 },
    );
    const verified = {
      installationId: "150109806",
      accountId: "42",
      accountLogin: "acme",
      accountType: "Organization",
      repositorySelection: "selected",
      settingsUrl: "https://github.com/settings/installations/150109806",
      permissions: { contents: "write", pull_requests: "write" },
      repositories: [{ repository: "acme/api", defaultBranch: "main", private: true }],
    };
    github.verify.mockResolvedValue(verified);
    database.client.query.mockImplementation(async (query: unknown) => {
      if (sql(query).includes("INSERT INTO github_webhook_deliveries"))
        return { rows: [{ delivery_id: deliveryId }], rowCount: 1 };
      if (sql(query).includes("SELECT org_id FROM github_app_installations"))
        return { rows: [{ org_id: "org-1" }], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    });
    const result = await processGithubWebhook({
      deliveryId,
      event: "installation_repositories",
      rawBody: '{"action":"added","installation":{"id":150109806}}',
      payload: { action: "added", installation: { id: 150109806 } },
    });
    expect(result.outcome).toBe("installation_synchronized");
    expect(github.verify).toHaveBeenCalledWith("150109806");
    expect(installation.sync).toHaveBeenCalledWith(database.client, "org-1", verified);
  });

  it("audits only pull requests created by a tracked CloseSpan run", async () => {
    database.pool.query.mockImplementation(async (query: unknown) =>
      sql(query).includes("FROM github_webhook_deliveries")
        ? { rows: [], rowCount: 0 }
        : { rows: [{ org_id: "org-1" }], rowCount: 1 },
    );
    database.client.query.mockImplementation(async (query: unknown) => {
      if (sql(query).includes("INSERT INTO github_webhook_deliveries"))
        return { rows: [{ delivery_id: deliveryId }], rowCount: 1 };
      if (sql(query).includes("FROM agent_runs run"))
        return { rows: [{ id: "run-1" }], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    });
    const result = await processGithubWebhook({
      deliveryId,
      event: "pull_request",
      rawBody: '{"action":"closed"}',
      payload: {
        action: "closed",
        installation: { id: 150109806 },
        repository: { full_name: "acme/api" },
        pull_request: { number: 12, merged: true },
      },
    });
    expect(result.outcome).toBe("tracked_pull_request_merged");
    expect(database.client.query.mock.calls.some(([query]) => sql(query).includes("INSERT INTO audit_events")))
      .toBe(true);
    expect(database.client.query.mock.calls.some(([query]) => sql(query).includes("UPDATE agent_runs")))
      .toBe(false);
  });
});
