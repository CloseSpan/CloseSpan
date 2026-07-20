import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createNangoConnectionAttempt,
  getNangoConnectionStatuses,
  markNangoConnectionNeedsReconnect,
  NANGO_TAGS,
  type NangoConnectionAttempt,
  reconcileNangoAuthEvent,
  resetNangoMemoryState,
  updateNangoSyncState,
} from "./nango-repository";

const baseAttempt = {
  orgId: "org_alpha",
  integrationId: "int_github",
  providerConfigKey: "github-getting-started",
  nangoEnvironment: "DEV",
  actorId: "user_1",
  actorName: "Ada Admin",
  actorEmail: "ada@example.com",
  idempotencyKey: "nango_security_default",
  traceId: "trace_nango_security",
};

function exactTags(
  attempt: NangoConnectionAttempt,
): Record<string, string> {
  return {
    [NANGO_TAGS.attemptId]: attempt.id,
    [NANGO_TAGS.integrationId]: attempt.integrationId,
    [NANGO_TAGS.organizationId]: attempt.orgId,
    [NANGO_TAGS.endUserId]: `${attempt.orgId}:${attempt.actorId}`,
    [NANGO_TAGS.endUserEmail]: attempt.actorEmail,
    [NANGO_TAGS.endUserDisplayName]: attempt.actorName,
  };
}

async function createAttempt(
  overrides: Partial<Parameters<typeof createNangoConnectionAttempt>[0]> = {},
): Promise<NangoConnectionAttempt> {
  return createNangoConnectionAttempt({
    ...baseAttempt,
    idempotencyKey: `nango_${crypto.randomUUID()}`,
    expiresAt: new Date(Date.now() + 60_000),
    ...overrides,
  });
}

async function sendAuth(
  attempt: NangoConnectionAttempt,
  overrides: Partial<Parameters<typeof reconcileNangoAuthEvent>[0]> = {},
) {
  return reconcileNangoAuthEvent({
    payloadHash: `a${attempt.id.replaceAll("-", "").slice(1)}`.padEnd(64, "0"),
    operation: "creation",
    providerConfigKey: attempt.providerConfigKey,
    connectionId: `connection_${attempt.id}`,
    provider: "github",
    nangoEnvironment: attempt.nangoEnvironment,
    tags: exactTags(attempt),
    ...overrides,
  });
}

describe("Nango repository tenant and event security in memory mode", () => {
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

  it("binds a valid connection only to the attempt's organization", async () => {
    const alphaAttempt = await createAttempt();
    expect(await sendAuth(alphaAttempt)).toBe("processed");

    expect(await getNangoConnectionStatuses("org_alpha")).toEqual([
      expect.objectContaining({
        integrationId: "int_github",
        providerConfigKey: "github-getting-started",
        state: "Connected",
      }),
    ]);
    expect(await getNangoConnectionStatuses("org_beta")).toEqual([]);
  });

  it.each(Object.values(NANGO_TAGS))(
    "rejects an auth event when exact tag %s does not match",
    async (tagName) => {
      const attempt = await createAttempt();
      const tags = exactTags(attempt);
      tags[tagName] = `${tags[tagName]}_tampered`;

      expect(
        await sendAuth(attempt, {
          payloadHash: `tag_${tagName}`.padEnd(64, "0").slice(0, 64),
          tags,
        }),
      ).toBe("ignored");
      expect(await getNangoConnectionStatuses(attempt.orgId)).toEqual([]);
    },
  );

  it("rejects an organization substitution even when the compound end-user tag is also changed", async () => {
    const attempt = await createAttempt();
    const tags = exactTags(attempt);
    tags[NANGO_TAGS.organizationId] = "org_beta";
    tags[NANGO_TAGS.endUserId] = `org_beta:${attempt.actorId}`;

    expect(
      await sendAuth(attempt, {
        payloadHash: "tenant_substitution".padEnd(64, "0"),
        tags,
      }),
    ).toBe("ignored");
    expect(await getNangoConnectionStatuses("org_alpha")).toEqual([]);
    expect(await getNangoConnectionStatuses("org_beta")).toEqual([]);
  });

  it.each([
    ["provider config", { providerConfigKey: "github-other" }],
    ["Nango environment", { nangoEnvironment: "PROD" }],
  ])("rejects a mismatched %s", async (_label, mismatch) => {
    const attempt = await createAttempt();
    expect(
      await sendAuth(attempt, {
        payloadHash: `mismatch_${_label}`.padEnd(64, "0").slice(0, 64),
        ...mismatch,
      }),
    ).toBe("ignored");
    expect(await getNangoConnectionStatuses(attempt.orgId)).toEqual([]);
  });

  it("expires a timed-out attempt and ignores its otherwise valid webhook", async () => {
    const attempt = await createAttempt({
      expiresAt: new Date(Date.now() - 1),
    });

    expect(await sendAuth(attempt)).toBe("ignored");
    expect(await getNangoConnectionStatuses(attempt.orgId)).toEqual([]);

    // Once expired, changing the clock-bearing object cannot revive the attempt.
    attempt.expiresAt = new Date(Date.now() + 60_000);
    expect(
      await sendAuth(attempt, {
        payloadHash: "expired_attempt_retry".padEnd(64, "0"),
      }),
    ).toBe("ignored");
  });

  it("preserves a live pending attempt when a different command races it", async () => {
    const current = await createAttempt();
    await expect(
      createAttempt({ traceId: "trace_competing_command" }),
    ).rejects.toThrow("A connection is already in progress.");

    expect(
      await sendAuth(current, {
        payloadHash: "current_pending_attempt".padEnd(64, "0"),
      }),
    ).toBe("processed");
    expect(await getNangoConnectionStatuses(current.orgId)).toEqual([
      expect.objectContaining({ state: "Connected" }),
    ]);
  });

  it("claims an auth payload hash once and reports exact replays as duplicates", async () => {
    const attempt = await createAttempt();
    const payloadHash = "duplicate_auth_event".padEnd(64, "0");

    expect(await sendAuth(attempt, { payloadHash })).toBe("processed");
    expect(await sendAuth(attempt, { payloadHash })).toBe("duplicate");
    expect(await getNangoConnectionStatuses(attempt.orgId)).toHaveLength(1);
  });

  it("does not let a distinct event from an old connected attempt replace a newer binding", async () => {
    const oldAttempt = await createAttempt({ traceId: "trace_old_binding" });
    expect(
      await sendAuth(oldAttempt, {
        payloadHash: "old_initial_connection".padEnd(64, "0"),
        connectionId: "connection_old",
      }),
    ).toBe("processed");

    const currentAttempt = await createAttempt({ traceId: "trace_new_binding" });
    expect(
      await sendAuth(currentAttempt, {
        payloadHash: "new_current_connection".padEnd(64, "0"),
        connectionId: "connection_current",
      }),
    ).toBe("processed");

    expect(
      await sendAuth(oldAttempt, {
        payloadHash: "late_distinct_old_event".padEnd(64, "0"),
        connectionId: "connection_stale_hijack",
      }),
    ).toBe("ignored");

    // The active connection remains the current attempt's connection.
    expect(
      await markNangoConnectionNeedsReconnect({
        payloadHash: "current_connection_refresh".padEnd(64, "0"),
        providerConfigKey: currentAttempt.providerConfigKey,
        connectionId: "connection_current",
        nangoEnvironment: currentAttempt.nangoEnvironment,
      }),
    ).toBe("processed");
    expect(await getNangoConnectionStatuses(currentAttempt.orgId)).toEqual([
      expect.objectContaining({ state: "Needs reconnect" }),
    ]);
  });

  it("prevents two organizations from owning the same Nango connection tuple", async () => {
    const alphaAttempt = await createAttempt({
      orgId: "org_alpha",
      traceId: "trace_alpha_shared_connection",
    });
    const betaAttempt = await createAttempt({
      orgId: "org_beta",
      actorId: "user_2",
      actorName: "Bea Admin",
      actorEmail: "bea@example.com",
      traceId: "trace_beta_shared_connection",
    });
    const connectionId = "shared_nango_connection";

    expect(
      await sendAuth(alphaAttempt, {
        payloadHash: "alpha_shared_connection".padEnd(64, "0"),
        connectionId,
      }),
    ).toBe("processed");
    expect(
      await sendAuth(betaAttempt, {
        payloadHash: "beta_shared_connection".padEnd(64, "0"),
        connectionId,
      }),
    ).toBe("ignored");
    expect(await getNangoConnectionStatuses("org_alpha")).toHaveLength(1);
    expect(await getNangoConnectionStatuses("org_beta")).toEqual([]);
  });

  it("scopes refresh failures by provider, connection, and environment", async () => {
    const attempt = await createAttempt();
    const connectionId = "connection_refresh_test";
    expect(await sendAuth(attempt, { connectionId })).toBe("processed");

    expect(
      await markNangoConnectionNeedsReconnect({
        payloadHash: "wrong_refresh_environment".padEnd(64, "0"),
        providerConfigKey: attempt.providerConfigKey,
        connectionId,
        nangoEnvironment: "PROD",
      }),
    ).toBe("ignored");
    expect(
      await markNangoConnectionNeedsReconnect({
        payloadHash: "valid_refresh_failure".padEnd(64, "0"),
        providerConfigKey: attempt.providerConfigKey,
        connectionId,
        nangoEnvironment: attempt.nangoEnvironment,
        errorCode: "OAuth token expired: do not leak this detail",
      }),
    ).toBe("processed");
    expect(
      await markNangoConnectionNeedsReconnect({
        payloadHash: "valid_refresh_failure".padEnd(64, "0"),
        providerConfigKey: attempt.providerConfigKey,
        connectionId,
        nangoEnvironment: attempt.nangoEnvironment,
      }),
    ).toBe("duplicate");

    expect(await getNangoConnectionStatuses(attempt.orgId)).toEqual([
      expect.objectContaining({
        state: "Needs reconnect",
        lastErrorCode: "oauth_token_expired_do_not_leak_this_detail",
      }),
    ]);
  });

  it("deduplicates sync events and does not resolve a reconnect state implicitly", async () => {
    const attempt = await createAttempt();
    const connectionId = "connection_sync_test";
    expect(await sendAuth(attempt, { connectionId })).toBe("processed");
    await markNangoConnectionNeedsReconnect({
      payloadHash: "refresh_before_sync".padEnd(64, "0"),
      providerConfigKey: attempt.providerConfigKey,
      connectionId,
      nangoEnvironment: attempt.nangoEnvironment,
    });

    const syncEvent = {
      payloadHash: "successful_sync_event".padEnd(64, "0"),
      providerConfigKey: attempt.providerConfigKey,
      connectionId,
      nangoEnvironment: attempt.nangoEnvironment,
      syncName: "github-feedback",
      syncVariant: "",
      model: "GithubFeedback",
      modifiedAfter: "2026-07-19T09:59:00.000Z",
      success: true,
      completedAt: new Date("2026-07-19T10:00:00.000Z"),
    } as const;
    expect(await updateNangoSyncState(syncEvent)).toBe("processed");
    expect(await updateNangoSyncState(syncEvent)).toBe("duplicate");
    expect(await getNangoConnectionStatuses(attempt.orgId)).toEqual([
      expect.objectContaining({
        state: "Needs reconnect",
        lastSyncStatus: "Success",
        lastSyncAt: "2026-07-19T10:00:00.000Z",
        lastErrorCode: null,
      }),
    ]);
  });
});
