import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  client: { query: vi.fn() },
  transaction: vi.fn(),
  listAccounts: vi.fn(),
  proxyGet: vi.fn(),
  getConnection: vi.fn(),
  claimImport: vi.fn(),
  updateImportCursor: vi.fn(),
  updateImportState: vi.fn(),
  resolveAccount: vi.fn(),
}));

vi.mock("./db", () => ({
  transaction: state.transaction,
}));

vi.mock("./pipedream", () => ({
  pipedreamExternalUserId: (orgId: string) => `closespan:${orgId}`,
  getPipedreamClient: () => ({
    accounts: { listByExternalUser: state.listAccounts },
    proxy: { get: state.proxyGet },
  }),
}));

vi.mock("./pipedream-repository", () => ({
  getPipedreamConnection: state.getConnection,
  claimPipedreamImport: state.claimImport,
  listPipedreamConnections: vi.fn(async () => []),
  updatePipedreamImportCursor: state.updateImportCursor,
  updatePipedreamImportState: state.updateImportState,
}));

vi.mock("./workspace-persistence", () => ({
  workspacePersistenceMode: () => "postgres",
}));

vi.mock("./customer-account-repository", () => ({
  resolveOrCreateExternalAccount: state.resolveAccount,
}));

import {
  normalizeZendeskTicket,
  pullPipedreamFeedback,
} from "./pipedream-feedback-import";

function ticket(overrides: Record<string, unknown> = {}) {
  return {
    id: 101,
    url: "https://acme.zendesk.com/api/v2/tickets/101.json",
    organization_id: 42,
    requester_id: 9001,
    subject: "Export is empty",
    description: "The export is broken for ops@example.com",
    priority: "high",
    created_at: "2026-08-08T10:00:00.000Z",
    tags: ["production", "exports"],
    ...overrides,
  };
}

describe("Zendesk customer import", () => {
  beforeEach(() => {
    state.client.query.mockReset().mockImplementation(async (sql: unknown) => {
      if (typeof sql === "string" && sql.includes("SELECT external_id FROM feedback_items")) {
        return { rows: [], rowCount: 0 };
      }
      return { rows: [], rowCount: 1 };
    });
    state.transaction.mockReset().mockImplementation(
      async (work: (client: typeof state.client) => Promise<unknown>) =>
        work(state.client),
    );
    state.listAccounts.mockReset().mockResolvedValue([
      {
        id: "apn_zendesk",
        app: { nameSlug: "zendesk" },
        healthy: true,
        dead: false,
      },
    ]);
    state.proxyGet.mockReset();
    state.getConnection.mockReset().mockResolvedValue({
      integrationId: "int_zendesk",
      accountId: "apn_zendesk",
      accountName: "Zendesk production",
      state: "Connected",
      importCursor: null,
    });
    state.claimImport.mockReset().mockResolvedValue({
      importCursor: null,
      leaseToken: "1",
    });
    state.updateImportCursor.mockReset().mockResolvedValue(undefined);
    state.updateImportState.mockReset().mockResolvedValue(undefined);
    state.resolveAccount.mockReset().mockResolvedValue({
      accountId: "acct_acme",
      created: true,
    });
  });

  it("normalizes a ticket with the real organization identity and redacts its quote", () => {
    const organizations = new Map([
      [
        "42",
        {
          externalId: "42",
          name: "Acme Health",
          domain: "acme.example",
          tier: "Enterprise",
          customerSince: 2022,
          sourceCreatedAt: new Date("2022-02-01T00:00:00.000Z"),
          sourceUpdatedAt: new Date("2026-08-08T09:00:00.000Z"),
          metadata: {},
        },
      ],
    ]);

    const normalized = normalizeZendeskTicket(ticket(), organizations);

    expect(normalized).toMatchObject({
      externalId: "101",
      customer: "Acme Health",
      type: "Bug",
      severity: "High",
      redacted: true,
      environment: "production, exports",
      observedAt: "2026-08-08T10:00:00.000Z",
      account: expect.objectContaining({
        externalId: "42",
        name: "Acme Health",
      }),
    });
    expect(normalized?.quote).not.toContain("ops@example.com");
  });

  it("keeps requester-only tickets unlinked instead of inventing a customer account", () => {
    const normalized = normalizeZendeskTicket(
      ticket({ organization_id: null, requester_id: 9001 }),
    );

    expect(normalized).toMatchObject({
      customer: "Zendesk requester #9001",
      account: null,
    });
  });

  it("fetches organization details once and links every ticket for that organization", async () => {
    state.proxyGet.mockImplementation(async (request: { url: string }) => {
      if (request.url === "/api/v2/incremental/tickets/cursor.json") {
        return {
          tickets: [ticket(), ticket({ id: 102, subject: "Export fails again" })],
          after_cursor: "cursor_after_first_import",
          end_of_stream: true,
        };
      }
      if (request.url === "/api/v2/organizations/show_many.json") {
        return {
          organizations: [
            {
              id: 42,
              name: "Acme Health",
              domain_names: ["Acme.Example"],
              tags: ["enterprise"],
              created_at: "2022-02-01T00:00:00.000Z",
              updated_at: "2026-08-08T09:00:00.000Z",
            },
          ],
        };
      }
      throw new Error(`Unexpected Zendesk endpoint: ${request.url}`);
    });

    const result = await pullPipedreamFeedback({
      orgId: "org_alpha",
      integrationId: "int_zendesk",
      accountId: "apn_zendesk",
    });

    expect(result).toMatchObject({
      accountName: "Zendesk production",
      fetched: 2,
      created: 2,
      updated: 0,
      skipped: 0,
    });
    expect(state.proxyGet).toHaveBeenCalledWith(
      expect.objectContaining({
        externalUserId: "closespan:org_alpha",
        accountId: "apn_zendesk",
        url: "/api/v2/incremental/tickets/cursor.json",
        params: { start_time: "1", per_page: "100" },
      }),
      { timeoutInSeconds: 30 },
    );
    expect(state.proxyGet).toHaveBeenCalledWith(
      expect.objectContaining({
        externalUserId: "closespan:org_alpha",
        accountId: "apn_zendesk",
        url: "/api/v2/organizations/show_many.json",
        params: { ids: "42" },
      }),
      { timeoutInSeconds: 30 },
    );
    expect(state.resolveAccount).toHaveBeenCalledTimes(1);
    expect(state.resolveAccount).toHaveBeenCalledWith(
      state.client,
      expect.objectContaining({
        orgId: "org_alpha",
        integrationId: "int_zendesk",
        sourceNamespace: "zendesk:acme.zendesk.com:organizations",
        sourceNamespaceAliases: [
          "pipedream:apn_zendesk:zendesk:organizations",
        ],
        externalAccountId: "42",
        name: "Acme Health",
        domain: "acme.example",
        tier: "Enterprise",
      }),
    );

    const feedbackInserts = state.client.query.mock.calls.filter(([sql]) =>
      typeof sql === "string" && sql.includes("INSERT INTO feedback_items"),
    );
    expect(feedbackInserts).toHaveLength(2);
    for (const [, values] of feedbackInserts) {
      expect(values[2]).toBe("Acme Health");
      expect(values[12]).toBe("acct_acme");
    }
    expect(state.updateImportCursor).toHaveBeenCalledWith(state.client, {
      orgId: "org_alpha",
      integrationId: "int_zendesk",
      accountId: "apn_zendesk",
      cursor: "cursor_after_first_import",
      leaseToken: "1",
    });
  });

  it("keeps Zendesk customer and ticket identities stable across a reconnect", async () => {
    state.listAccounts.mockResolvedValue([
      {
        id: "apn_old_connection",
        app: { nameSlug: "zendesk" },
        healthy: true,
        dead: false,
      },
      {
        id: "apn_new_connection",
        app: { nameSlug: "zendesk" },
        healthy: true,
        dead: false,
      },
    ]);
    state.getConnection.mockImplementation(
      async (_orgId: string, integrationId: string, accountId: string) => ({
        integrationId,
        accountId,
        accountName: "Zendesk production",
        state: "Connected",
        importCursor: null,
      }),
    );
    state.proxyGet.mockImplementation(async (request: { url: string }) => {
      if (request.url === "/api/v2/incremental/tickets/cursor.json") {
        return {
          tickets: [
            ticket({
              url: "https://acme.zendesk.com/api/v2/tickets/101.json",
            }),
          ],
          after_cursor: "cursor_reconnect",
          end_of_stream: true,
        };
      }
      if (request.url === "/api/v2/organizations/show_many.json") {
        return {
          organizations: [
            {
              id: 42,
              url: "https://acme.zendesk.com/api/v2/organizations/42.json",
              name: "Acme Health",
              domain_names: ["acme.example"],
              created_at: "2022-02-01T00:00:00.000Z",
              updated_at: "2026-08-08T09:00:00.000Z",
            },
          ],
        };
      }
      throw new Error(`Unexpected Zendesk endpoint: ${request.url}`);
    });

    await pullPipedreamFeedback({
      orgId: "org_alpha",
      integrationId: "int_zendesk",
      accountId: "apn_old_connection",
    });
    await pullPipedreamFeedback({
      orgId: "org_alpha",
      integrationId: "int_zendesk",
      accountId: "apn_new_connection",
    });

    const accountNamespaces = state.resolveAccount.mock.calls.map(
      ([, input]) => input.sourceNamespace,
    );
    expect(accountNamespaces).toHaveLength(2);
    expect(accountNamespaces[0]).toBe(accountNamespaces[1]);
    expect(accountNamespaces[0]).not.toContain("apn_old_connection");
    expect(accountNamespaces[1]).not.toContain("apn_new_connection");

    const feedbackWrites = state.client.query.mock.calls.filter(([sql]) =>
      typeof sql === "string" && sql.includes("INSERT INTO feedback_items"),
    );
    expect(feedbackWrites).toHaveLength(2);
    expect(feedbackWrites[0]?.[1]?.[0]).toBe(feedbackWrites[1]?.[1]?.[0]);
    expect(feedbackWrites[0]?.[1]?.[10]).toBe(feedbackWrites[1]?.[1]?.[10]);
  });

  it("fails closed when Zendesk does not provide a stable HTTPS instance URL", async () => {
    state.proxyGet.mockImplementation(async (request: { url: string }) => {
      if (request.url === "/api/v2/incremental/tickets/cursor.json") {
        return {
          tickets: [ticket({ url: undefined })],
          after_cursor: "cursor_invalid_source",
          end_of_stream: true,
        };
      }
      if (request.url === "/api/v2/organizations/show_many.json") {
        return {
          organizations: [
            {
              id: 42,
              name: "Acme Health",
              domain_names: ["acme.example"],
              updated_at: "2026-08-08T09:00:00.000Z",
            },
          ],
        };
      }
      throw new Error(`Unexpected Zendesk endpoint: ${request.url}`);
    });

    await expect(
      pullPipedreamFeedback({
        orgId: "org_alpha",
        integrationId: "int_zendesk",
        accountId: "apn_zendesk",
      }),
    ).rejects.toThrow("zendesk_source_instance_missing");
    expect(state.transaction).not.toHaveBeenCalled();
    expect(state.updateImportCursor).not.toHaveBeenCalled();
  });

  it("completes a valid empty Zendesk pull without inventing a tenant identity", async () => {
    state.proxyGet.mockImplementation(async (request: { url: string }) => {
      if (request.url === "/api/v2/incremental/tickets/cursor.json") {
        return {
          tickets: [],
          after_cursor: "cursor_empty_success",
          end_of_stream: true,
        };
      }
      throw new Error(`Unexpected Zendesk endpoint: ${request.url}`);
    });

    const result = await pullPipedreamFeedback({
      orgId: "org_alpha",
      integrationId: "int_zendesk",
      accountId: "apn_zendesk",
    });

    expect(result).toMatchObject({
      fetched: 0,
      created: 0,
      updated: 0,
      skipped: 0,
    });
    expect(state.resolveAccount).not.toHaveBeenCalled();
    expect(state.client.query).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE integrations SET last_sync_at=now()"),
      ["org_alpha"],
    );
    expect(state.updateImportState).toHaveBeenCalledWith(
      expect.objectContaining({ status: "Succeeded", count: 0 }),
    );
    expect(state.updateImportCursor).toHaveBeenCalledWith(state.client, {
      orgId: "org_alpha",
      integrationId: "int_zendesk",
      accountId: "apn_zendesk",
      cursor: "cursor_empty_success",
      leaseToken: "1",
    });
  });

  it("continues from the saved cursor and commits the last cursor from a bounded batch", async () => {
    state.getConnection.mockResolvedValue({
      integrationId: "int_zendesk",
      accountId: "apn_zendesk",
      accountName: "Zendesk production",
      state: "Connected",
      importCursor: "cursor_stale_before_claim",
    });
    state.claimImport.mockResolvedValue({
      importCursor: "cursor_saved",
      leaseToken: "7",
    });
    let page = 0;
    state.proxyGet.mockImplementation(async (request: { url: string }) => {
      if (request.url === "/api/v2/incremental/tickets/cursor.json") {
        page += 1;
        return {
          tickets: [ticket({ id: page, organization_id: null })],
          after_cursor: `cursor_page_${page}`,
          end_of_stream: false,
        };
      }
      throw new Error(`Unexpected Zendesk endpoint: ${request.url}`);
    });

    const result = await pullPipedreamFeedback({
      orgId: "org_alpha",
      integrationId: "int_zendesk",
      accountId: "apn_zendesk",
    });

    expect(result.fetched).toBe(5);
    const ticketCalls = state.proxyGet.mock.calls.filter(
      ([request]) =>
        request.url === "/api/v2/incremental/tickets/cursor.json",
    );
    expect(ticketCalls).toHaveLength(5);
    expect(ticketCalls[0]?.[0]?.params).toEqual({
      cursor: "cursor_saved",
      per_page: "100",
    });
    expect(ticketCalls[1]?.[0]?.params).toEqual({
      cursor: "cursor_page_1",
      per_page: "100",
    });
    expect(ticketCalls[4]?.[0]?.params).toEqual({
      cursor: "cursor_page_4",
      per_page: "100",
    });
    expect(state.updateImportCursor).toHaveBeenCalledWith(state.client, {
      orgId: "org_alpha",
      integrationId: "int_zendesk",
      accountId: "apn_zendesk",
      cursor: "cursor_page_5",
      leaseToken: "7",
    });
  });

  it("does not advance the cursor when feedback persistence fails", async () => {
    state.proxyGet.mockResolvedValue({
      tickets: [ticket({ organization_id: null })],
      after_cursor: "cursor_must_not_commit",
      end_of_stream: true,
    });
    state.transaction.mockRejectedValueOnce(new Error("feedback_write_failed"));

    await expect(
      pullPipedreamFeedback({
        orgId: "org_alpha",
        integrationId: "int_zendesk",
        accountId: "apn_zendesk",
      }),
    ).rejects.toThrow("feedback_write_failed");

    expect(state.updateImportCursor).not.toHaveBeenCalled();
    expect(state.updateImportState).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: "Failed" }),
    );
  });
});
