import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const authState = vi.hoisted(() => ({
  session: null as null | {
    user: { email: string; name?: string | null };
  },
  activeOrganizationId: null as string | null,
  memberships: vi.fn(),
  ensureMemberships: vi.fn(),
  demoWorkspace: vi.fn(),
  demoSessionId: null as string | null,
  demoReturnOrgId: null as string | null,
}));

vi.mock("@/auth", () => ({
  auth: vi.fn(async () => authState.session),
}));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: vi.fn((name: string) => {
      const value = name === "closespan_active_org" ? authState.activeOrganizationId
        : name === "closespan_demo_org" ? authState.demoSessionId
          : name === "closespan_demo_return_org" ? authState.demoReturnOrgId : null;
      return value ? { value } : undefined;
    }),
  })),
}));
vi.mock("./db", () => ({
  persistenceMode: vi.fn(() => "postgres"),
  databasePool: vi.fn(() => ({ query: vi.fn() })),
  transaction: vi.fn(),
}));
vi.mock("./organization-repository", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("./organization-repository")
  >();
  return {
    ...actual,
    ensureOrganizationMemberships: authState.ensureMemberships,
    listOrganizationMemberships: authState.memberships,
  };
});
vi.mock("./onboarding-entry", async (original) => ({ ...await original<typeof import("./onboarding-entry")>(), getOnboardingDemoWorkspace: authState.demoWorkspace }));

import {
  resolveWorkspaceAccess,
  withDemoOrganizationMembership,
  workspaceUserFromMemberships,
} from "./auth-user";
import type { OrganizationMembership } from "./organization-repository";
import { demoSessionCookieValue } from "./onboarding-entry";

const memberships: OrganizationMembership[] = [
  {
    memberId: "member_acme",
    organizationId: "org_acme",
    organizationName: "Acme",
    displayName: "Workspace Name",
    email: "sam@example.com",
    role: "Admin",
  },
  {
    memberId: "member_beta",
    organizationId: "org_beta",
    organizationName: "Beta",
    displayName: "Workspace Name",
    email: "sam@example.com",
    role: "Contributor",
  },
];

describe("onboarding demo visitor access", () => {
  beforeEach(() => {
    vi.stubEnv("APP_MODE", "production");
    vi.stubEnv("DEMO_MEMORY_ORG_ID", "");
    authState.session = { user: { email: "new@example.com", name: "New User" } };
    authState.memberships.mockReset().mockResolvedValue(memberships);
    authState.ensureMemberships.mockReset();
    authState.demoWorkspace.mockReset().mockResolvedValue({ id: "org_demo", name: "CloseSpan Demo" });
    authState.activeOrganizationId = "org_demo";
    authState.demoSessionId = demoSessionCookieValue("new@example.com", "org_demo");
    authState.demoReturnOrgId = "org_acme";
  });
  afterEach(() => {
    authState.demoSessionId = null;
    authState.demoReturnOrgId = null;
    vi.unstubAllEnvs();
  });
  it("grants temporary Viewer access without adding a stored membership", async () => {
    expect(await resolveWorkspaceAccess()).toMatchObject({ status: "granted", user: {
      orgId: "org_demo", role: "Viewer", demoSession: { returnOrgId: "org_acme", returnOrganizationName: "Acme" },
    } });
    expect(authState.ensureMemberships).not.toHaveBeenCalled();
  });
  it("still creates the new user's private workspace before entering demo", async () => {
    authState.memberships.mockResolvedValue([]);
    authState.ensureMemberships.mockResolvedValue(memberships.slice(0, 1));
    expect(await resolveWorkspaceAccess()).toMatchObject({ status: "granted", user: { orgId: "org_demo", role: "Viewer" } });
    expect(authState.ensureMemberships).toHaveBeenCalledWith("new@example.com", "New User");
  });
  it("does not grant access to a live tenant named in forged cookies", async () => {
    authState.activeOrganizationId = "org_private_other";
    authState.demoSessionId = demoSessionCookieValue("new@example.com", "org_private_other");
    expect(await resolveWorkspaceAccess()).toMatchObject({ status: "granted", user: { orgId: "org_acme", role: "Admin" } });
  });
  it("does not accept a forged return organization", async () => {
    authState.demoReturnOrgId = "org_private_other";
    expect(await resolveWorkspaceAccess()).toMatchObject({ status: "granted", user: { demoSession: { returnOrgId: "org_acme" } } });
  });
  it("does not carry another account's demo preference into a new sign-in", async () => {
    authState.demoSessionId = demoSessionCookieValue("someone@example.com", "org_demo");
    expect(await resolveWorkspaceAccess()).toMatchObject({ status: "granted", user: { orgId: "org_acme" } });
    expect(authState.demoWorkspace).not.toHaveBeenCalled();
  });
  it("does not expose the demo before explicit entry", async () => {
    authState.demoSessionId = null;
    const access = await resolveWorkspaceAccess();
    expect(access).toMatchObject({ status: "granted", user: { orgId: "org_acme" } });
    expect(authState.demoWorkspace).not.toHaveBeenCalled();
    if (access.status === "granted") expect(access.user.organizations).not.toContainEqual(expect.objectContaining({ id: "org_demo" }));
  });
  it("revokes virtual demo access when the presentation is no longer available", async () => {
    authState.demoWorkspace.mockResolvedValue(null);
    expect(await resolveWorkspaceAccess()).toMatchObject({ status: "granted", user: { orgId: "org_acme" } });
  });
  it("also restricts an existing demo admin to Viewer during an explicit demo session", async () => {
    authState.memberships.mockResolvedValue([...memberships, { ...memberships[0], organizationId: "org_demo", role: "Admin" }]);
    expect(await resolveWorkspaceAccess()).toMatchObject({ status: "granted", user: { orgId: "org_demo", role: "Viewer" } });
  });
});

describe("workspace organization selection", () => {
  it("selects a validated active organization from multiple memberships", () => {
    const user = workspaceUserFromMemberships(
      memberships,
      "Sam.Example+work@gmail.com",
      "Sam Operator",
      "org_beta",
    );

    expect(user).toMatchObject({
      id: "member_beta",
      orgId: "org_beta",
      organizationName: "Beta",
      name: "Sam Operator",
      email: "samexample@gmail.com",
      role: "Contributor",
    });
    expect(user?.organizations).toEqual([
      { id: "org_acme", name: "Acme", role: "Admin" },
      { id: "org_beta", name: "Beta", role: "Contributor" },
    ]);
  });

  it("falls back deterministically when the requested organization is unauthorized", () => {
    const user = workspaceUserFromMemberships(
      memberships,
      "sam@example.com",
      null,
      "org_not_a_membership",
    );

    expect(user).toMatchObject({
      id: "member_acme",
      orgId: "org_acme",
      name: "Workspace Name",
      role: "Admin",
    });
  });

  it("denies access when no membership exists", () => {
    expect(
      workspaceUserFromMemberships([], "sam@example.com", "Sam", "org_acme"),
    ).toBeNull();
  });

  it("prepends one virtual demo membership without duplicating a stored demo row", () => {
    const merged = withDemoOrganizationMembership(
      [
        {
          ...memberships[0],
          memberId: "stored_demo",
          organizationId: "org_northstar",
          organizationName: "Legacy demo row",
        },
        memberships[1],
      ],
      "sam@example.com",
      "Sam Operator",
    );

    expect(merged).toHaveLength(2);
    expect(merged[0]).toMatchObject({
      memberId: expect.stringMatching(/^google_[a-f0-9]{24}$/),
      organizationId: "org_northstar",
      organizationName: "CloseSpan Demo",
      displayName: "Sam Operator",
      role: "Admin",
    });
    expect(merged[1]).toEqual(memberships[1]);
  });
});

describe("production workspace access", () => {
  beforeEach(() => {
    process.env.APP_MODE = "production";
    authState.session = null;
    authState.activeOrganizationId = null;
    authState.memberships.mockReset();
    authState.ensureMemberships.mockReset();
  });

  it("grants every verified user access to an existing organization", async () => {
    authState.session = {
      user: { email: "sam@example.com", name: "Sam" },
    };
    authState.memberships.mockResolvedValue(memberships);

    await expect(resolveWorkspaceAccess()).resolves.toMatchObject({
      status: "granted",
      user: { email: "sam@example.com", orgId: "org_acme", role: "Admin" },
    });
    expect(authState.ensureMemberships).not.toHaveBeenCalled();
  });

  it("grants the owner access to a stored production organization", async () => {
    authState.session = {
      user: {
        email: "Shanmukh.Sain+founder@googlemail.com",
        name: "Shanmukh Sain",
      },
    };
    authState.memberships.mockResolvedValue([
      {
        ...memberships[0],
        email: "shanmukhsain@gmail.com",
      },
    ]);

    const access = await resolveWorkspaceAccess();

    expect(access).toMatchObject({
      status: "granted",
      user: {
        orgId: "org_acme",
        organizationName: "Acme",
        email: "shanmukhsain@gmail.com",
        name: "Shanmukh Sain",
        organizations: [
          { id: "org_acme", name: "Acme", role: "Admin" },
        ],
      },
    });
  });

  it("provisions a private organization for a verified first-time user", async () => {
    authState.session = { user: { email: "sam@example.com", name: "Sam" } };
    authState.memberships.mockResolvedValue([]);
    authState.ensureMemberships.mockResolvedValue(memberships.slice(0, 1));

    await expect(resolveWorkspaceAccess()).resolves.toMatchObject({
      status: "granted",
      user: { email: "sam@example.com", orgId: "org_acme", role: "Admin" },
    });
    expect(authState.ensureMemberships).toHaveBeenCalledWith(
      "sam@example.com",
      "Sam",
    );
  });

  it("selects a durable organization when its trusted cookie is active", async () => {
    authState.session = {
      user: { email: "shanmukhsain@gmail.com", name: "Shanmukh" },
    };
    authState.activeOrganizationId = "org_beta";
    authState.memberships.mockResolvedValue(memberships.map((membership) => ({
      ...membership,
      email: "shanmukhsain@gmail.com",
    })));

    await expect(resolveWorkspaceAccess()).resolves.toMatchObject({
      status: "granted",
      user: {
        orgId: "org_beta",
        organizationName: "Beta",
        role: "Contributor",
        organizations: [
          { id: "org_acme", name: "Acme", role: "Admin" },
          { id: "org_beta", name: "Beta", role: "Contributor" },
        ],
      },
    });
  });

  it("returns unavailable when production memberships cannot load", async () => {
    authState.session = {
      user: { email: "shanmukhsain@gmail.com", name: "Shanmukh" },
    };
    authState.memberships.mockRejectedValue(new Error("database offline"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(resolveWorkspaceAccess()).resolves.toEqual({
      status: "unavailable",
      email: "shanmukhsain@gmail.com",
    });
    expect(consoleError).toHaveBeenCalledWith(
      "Unable to load or create the selected workspace",
      { errorType: "Error" },
    );
    consoleError.mockRestore();
  });

  it("returns unavailable instead of inventing access when an active durable workspace cannot load", async () => {
    authState.session = {
      user: { email: "shanmukhsain@gmail.com", name: "Shanmukh" },
    };
    authState.activeOrganizationId = "org_acme";
    authState.memberships.mockRejectedValue(new Error("database offline"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(resolveWorkspaceAccess()).resolves.toEqual({
      status: "unavailable",
      email: "shanmukhsain@gmail.com",
    });
    expect(consoleError).toHaveBeenCalledTimes(1);
    consoleError.mockRestore();
  });

  it("returns unavailable when first-time workspace provisioning fails", async () => {
    authState.session = {
      user: { email: "shanmukhsain@gmail.com", name: "Shanmukh" },
    };
    authState.memberships.mockResolvedValue([]);
    authState.ensureMemberships.mockRejectedValue(new Error("database offline"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(resolveWorkspaceAccess()).resolves.toEqual({
      status: "unavailable",
      email: "shanmukhsain@gmail.com",
    });
    expect(consoleError).toHaveBeenCalledWith(
      "Unable to load or create the selected workspace",
      { errorType: "Error" },
    );
    consoleError.mockRestore();
  });
});

describe("hybrid demo access", () => {
  beforeEach(() => {
    process.env.APP_MODE = "demo";
    process.env.DEMO_MEMORY_ORG_ID = "org_northstar";
    authState.session = {
      user: { email: "sam@example.com", name: "Sam" },
    };
    authState.activeOrganizationId = null;
    authState.memberships.mockReset();
    authState.ensureMemberships.mockReset();
  });

  it("merges the memory demo with durable organizations", async () => {
    authState.memberships.mockResolvedValue(memberships);

    await expect(resolveWorkspaceAccess()).resolves.toMatchObject({
      status: "granted",
      user: {
        orgId: "org_northstar",
        organizations: [
          { id: "org_northstar", name: "CloseSpan Demo", role: "Admin" },
          { id: "org_acme", name: "Acme", role: "Admin" },
          { id: "org_beta", name: "Beta", role: "Contributor" },
        ],
      },
    });
  });

  it("selects a durable organization through the trusted cookie", async () => {
    authState.activeOrganizationId = "org_beta";
    authState.memberships.mockResolvedValue(memberships);

    await expect(resolveWorkspaceAccess()).resolves.toMatchObject({
      status: "granted",
      user: {
        orgId: "org_beta",
        organizationName: "Beta",
      },
    });
  });

  it("keeps the demo available if PostgreSQL is temporarily unavailable", async () => {
    authState.memberships.mockRejectedValue(new Error("database offline"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(resolveWorkspaceAccess()).resolves.toMatchObject({
      status: "granted",
      user: { orgId: "org_northstar" },
    });
    expect(consoleError).toHaveBeenCalledWith(
      "Unable to list durable organizations; using the demo workspace",
      { errorType: "Error" },
    );
    consoleError.mockRestore();
  });

  it("does not hide a durable-workspace outage behind the demo", async () => {
    authState.activeOrganizationId = "org_acme";
    authState.memberships.mockRejectedValue(new Error("database offline"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(resolveWorkspaceAccess()).resolves.toEqual({
      status: "unavailable",
      email: "sam@example.com",
    });
    expect(consoleError).toHaveBeenCalledWith(
      "Unable to load or create the selected workspace",
      { errorType: "Error" },
    );
    consoleError.mockRestore();
  });
});
