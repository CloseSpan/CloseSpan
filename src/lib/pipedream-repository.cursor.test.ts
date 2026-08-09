import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  claimPipedreamImport,
  getPipedreamConnection,
  resetPipedreamMemoryState,
  savePipedreamAccount,
  updatePipedreamImportCursor,
  updatePipedreamImportState,
} from "./pipedream-repository";

describe("Pipedream memory import cursor", () => {
  beforeEach(() => {
    process.env.PERSISTENCE_MODE = "memory";
    resetPipedreamMemoryState();
  });

  afterEach(() => {
    delete process.env.PERSISTENCE_MODE;
    resetPipedreamMemoryState();
  });

  it("preserves a saved continuation cursor when account health is refreshed", async () => {
    const account = {
      id: "apn_memory_zendesk",
      app: { nameSlug: "zendesk" },
      name: "Zendesk production",
      healthy: true,
      dead: false,
      authorizedScopes: ["read"],
    };
    const input = {
      orgId: "org_memory",
      integrationId: "int_zendesk" as const,
      externalUserId: "closespan:org_memory",
      actorId: "user_admin",
      account: account as never,
    };

    await savePipedreamAccount(input);
    const claim = await claimPipedreamImport({
      orgId: input.orgId,
      integrationId: input.integrationId,
      accountId: account.id,
    });
    expect(claim).toMatchObject({ importCursor: null, leaseToken: "1" });
    await updatePipedreamImportCursor(null, {
      orgId: input.orgId,
      integrationId: input.integrationId,
      accountId: account.id,
      cursor: "cursor_saved",
      leaseToken: claim!.leaseToken,
    });
    await updatePipedreamImportState({
      orgId: input.orgId,
      integrationId: input.integrationId,
      accountId: account.id,
      status: "Succeeded",
      leaseToken: claim!.leaseToken,
    });
    await savePipedreamAccount(input);

    await expect(
      getPipedreamConnection(input.orgId, input.integrationId, account.id),
    ).resolves.toMatchObject({ importCursor: "cursor_saved" });
  });

  it("fences a completed worker after a newer import claims the connection", async () => {
    const account = {
      id: "apn_memory_zendesk",
      app: { nameSlug: "zendesk" },
      name: "Zendesk production",
      healthy: true,
      dead: false,
      authorizedScopes: ["read"],
    };
    const connection = {
      orgId: "org_memory",
      integrationId: "int_zendesk" as const,
      externalUserId: "closespan:org_memory",
      actorId: "user_admin",
      account: account as never,
    };
    const identity = {
      orgId: connection.orgId,
      integrationId: connection.integrationId,
      accountId: account.id,
    };

    await savePipedreamAccount(connection);
    const first = await claimPipedreamImport(identity);
    expect(first?.leaseToken).toBe("1");
    await updatePipedreamImportState({
      ...identity,
      status: "Failed",
      leaseToken: first!.leaseToken,
    });
    const second = await claimPipedreamImport(identity);
    expect(second?.leaseToken).toBe("2");

    await expect(
      updatePipedreamImportCursor(null, {
        ...identity,
        cursor: "cursor_from_stale_worker",
        leaseToken: first!.leaseToken,
      }),
    ).rejects.toThrow("stale_import_lease");
    await expect(
      updatePipedreamImportState({
        ...identity,
        status: "Succeeded",
        leaseToken: first!.leaseToken,
      }),
    ).rejects.toThrow("stale_import_lease");

    await updatePipedreamImportCursor(null, {
      ...identity,
      cursor: "cursor_from_current_worker",
      leaseToken: second!.leaseToken,
    });
    await updatePipedreamImportState({
      ...identity,
      status: "Succeeded",
      leaseToken: second!.leaseToken,
    });
    await expect(
      getPipedreamConnection(
        identity.orgId,
        identity.integrationId,
        identity.accountId,
      ),
    ).resolves.toMatchObject({
      importCursor: "cursor_from_current_worker",
      lastImportStatus: "Succeeded",
    });
  });
});
