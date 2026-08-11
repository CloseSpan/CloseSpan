import { beforeEach, describe, expect, it, vi } from "vitest";

const database = vi.hoisted(() => ({
  mode: "postgres" as "memory" | "postgres",
  pool: { query: vi.fn() },
}));

vi.mock("./db", () => ({
  persistenceMode: () => database.mode,
  databasePool: () => database.pool,
}));

vi.mock("./integration-catalog", () => ({
  integrationCatalog: [
    {
      id: "int_webhook",
      provider: "Custom webhook",
      category: "Feedback",
      displayOrder: 1,
      feedbackSource: true,
    },
  ],
}));

vi.mock("./ai-config", () => ({
  getAiPublicConfiguration: vi.fn(async () => ({
    configured: false,
    connectionStatus: "missing",
  })),
}));

vi.mock("./pipedream-repository", () => ({
  listPipedreamConnections: vi.fn(async () => []),
}));

import { getWorkspaceSetupStatus } from "./integration-repository";

describe("workspace setup integration compatibility", () => {
  beforeEach(() => {
    database.mode = "postgres";
    database.pool.query.mockReset().mockImplementation((sql: string) => {
      if (sql.includes("INSERT INTO integrations")) {
        return Promise.resolve({ rows: [], rowCount: 1 });
      }
      if (sql.includes("FROM feedback_items")) {
        return Promise.resolve({ rows: [{ count: 0 }], rowCount: 1 });
      }
      if (sql.includes("FROM github_app_installations")) {
        return Promise.resolve({
          rows: [{ installation_count: 0, repository_count: 0 }],
          rowCount: 1,
        });
      }
      if (sql.includes("secret.public_id AS webhook_public_id")) {
        return Promise.reject(
          Object.assign(
            new Error("column secret.public_id does not exist"),
            { code: "42703" },
          ),
        );
      }
      if (sql.includes("NULL::text AS webhook_public_id")) {
        return Promise.resolve({
          rows: [
            {
              id: "int_webhook",
              provider: "Custom webhook",
              connection_state: "Connected",
              last_sync_at: null,
              webhook_public_id: null,
            },
          ],
          rowCount: 1,
        });
      }
      throw new Error(`Unexpected query: ${sql}`);
    });
  });

  it("reports seeded feedback as ready in memory demo mode", async () => {
    database.mode = "memory";

    const status = await getWorkspaceSetupStatus("org_demo");

    expect(status.feedbackCount).toBe(5);
    expect(status.feedbackConnected).toBe(true);
    expect(status.setupComplete).toBe(false);
    expect(database.pool.query).not.toHaveBeenCalled();
  });

  it("retries without the webhook public ID when an older schema lacks that column", async () => {
    const status = await getWorkspaceSetupStatus("org_demo");

    expect(status.feedbackConnected).toBe(true);
    expect(status.connectedIntegrationIds).toEqual(["int_webhook"]);
    expect(status.webhook).toBeUndefined();

    const integrationQueries = database.pool.query.mock.calls.filter(
      ([sql]) =>
        typeof sql === "string" && sql.includes("webhook_public_id"),
    );
    expect(integrationQueries).toHaveLength(2);
    expect(integrationQueries[1]?.[0]).toContain(
      "NULL::text AS webhook_public_id",
    );
    expect(integrationQueries[1]?.[0]).not.toContain(
      "integration_webhook_secrets",
    );
    expect(integrationQueries[1]?.[1]).toEqual(["org_demo"]);
  });

  it("does not treat a broad GitHub connector as an authorized repository", async () => {
    database.pool.query.mockImplementation((sql: string) => {
      if (sql.includes("INSERT INTO integrations")) {
        return Promise.resolve({ rows: [], rowCount: 1 });
      }
      if (sql.includes("FROM feedback_items")) {
        return Promise.resolve({ rows: [{ count: 0 }], rowCount: 1 });
      }
      if (sql.includes("FROM github_app_installations")) {
        return Promise.resolve({
          rows: [{ installation_count: 0, repository_count: 0 }],
          rowCount: 1,
        });
      }
      if (sql.includes("secret.public_id AS webhook_public_id")) {
        return Promise.resolve({
          rows: [
            {
              id: "int_github",
              provider: "GitHub",
              connection_state: "Connected",
              last_sync_at: null,
              webhook_public_id: null,
            },
          ],
          rowCount: 1,
        });
      }
      throw new Error(`Unexpected query: ${sql}`);
    });

    const status = await getWorkspaceSetupStatus("org_demo");

    expect(status.githubConnected).toBe(false);
    expect(status.connectedIntegrationIds).not.toContain("int_github");
    expect(status.github).toBeUndefined();
  });

  it("marks GitHub ready only after an app installation has an active repository", async () => {
    database.pool.query.mockImplementation((sql: string) => {
      if (sql.includes("INSERT INTO integrations")) {
        return Promise.resolve({ rows: [], rowCount: 1 });
      }
      if (sql.includes("FROM feedback_items")) {
        return Promise.resolve({ rows: [{ count: 0 }], rowCount: 1 });
      }
      if (sql.includes("FROM github_app_installations")) {
        return Promise.resolve({
          rows: [{ installation_count: 1, repository_count: 2 }],
          rowCount: 1,
        });
      }
      if (sql.includes("secret.public_id AS webhook_public_id")) {
        return Promise.resolve({ rows: [], rowCount: 0 });
      }
      throw new Error(`Unexpected query: ${sql}`);
    });

    const status = await getWorkspaceSetupStatus("org_demo");

    expect(status.githubConnected).toBe(true);
    expect(status.connectedIntegrationIds).toContain("int_github");
    expect(status.github).toEqual({
      installationCount: 1,
      repositoryCount: 2,
    });
  });

  it("does not hide unrelated PostgreSQL failures", async () => {
    database.pool.query.mockImplementation((sql: string) => {
      if (sql.includes("INSERT INTO integrations")) {
        return Promise.resolve({ rows: [], rowCount: 1 });
      }
      if (sql.includes("FROM feedback_items")) {
        return Promise.resolve({ rows: [{ count: 0 }], rowCount: 1 });
      }
      if (sql.includes("FROM github_app_installations")) {
        return Promise.resolve({
          rows: [{ installation_count: 0, repository_count: 0 }],
          rowCount: 1,
        });
      }
      if (sql.includes("secret.public_id AS webhook_public_id")) {
        return Promise.reject(
          Object.assign(new Error("database connection was terminated"), {
            code: "57P01",
          }),
        );
      }
      throw new Error(`Unexpected query: ${sql}`);
    });

    await expect(getWorkspaceSetupStatus("org_demo")).rejects.toMatchObject({
      code: "57P01",
    });

    expect(
      database.pool.query.mock.calls.some(
        ([sql]) =>
          typeof sql === "string" &&
          sql.includes("NULL::text AS webhook_public_id"),
      ),
    ).toBe(false);
  });
});
