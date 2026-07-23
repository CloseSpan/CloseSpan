import { beforeEach, describe, expect, it, vi } from "vitest";

const authState = vi.hoisted(() => ({
  session: null as null | {
    user: { email: string; name?: string | null };
  },
  memberships: vi.fn(),
}));

vi.mock("@/auth", () => ({
  auth: vi.fn(async () => authState.session),
}));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ get: vi.fn(() => undefined) })),
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
    listOrganizationMemberships: authState.memberships,
  };
});

import {
  resolveWorkspaceAccess,
  workspaceUserFromMemberships,
} from "./auth-user";
import type { OrganizationMembership } from "./organization-repository";

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
});

describe("production private beta access", () => {
  beforeEach(() => {
    process.env.APP_MODE = "production";
    authState.session = null;
    authState.memberships.mockReset();
  });

  it("denies a non-owner even when a legacy membership exists", async () => {
    authState.session = {
      user: { email: "sam@example.com", name: "Sam" },
    };
    authState.memberships.mockResolvedValue(memberships);

    await expect(resolveWorkspaceAccess()).resolves.toEqual({
      status: "denied",
      email: "sam@example.com",
    });
    expect(authState.memberships).not.toHaveBeenCalled();
  });

  it("grants the owner access to the stored workspace", async () => {
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
        email: "shanmukhsain@gmail.com",
        name: "Shanmukh Sain",
      },
    });
  });

  it("returns a recoverable unavailable state when owner data cannot load", async () => {
    authState.session = {
      user: { email: "shanmukhsain@gmail.com", name: "Shanmukh" },
    };
    authState.memberships.mockRejectedValue(new Error("database offline"));

    await expect(resolveWorkspaceAccess()).resolves.toEqual({
      status: "unavailable",
      email: "shanmukhsain@gmail.com",
    });
  });

  it("gives the owner a deterministic workspace when membership is missing", async () => {
    authState.session = {
      user: { email: "shanmukhsain@gmail.com", name: "Shanmukh" },
    };
    authState.memberships.mockResolvedValue([]);

    await expect(resolveWorkspaceAccess()).resolves.toMatchObject({
      status: "granted",
      user: {
        email: "shanmukhsain@gmail.com",
        role: "Admin",
      },
    });
  });
});
