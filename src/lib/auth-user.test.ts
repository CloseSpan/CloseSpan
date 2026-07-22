import { describe, expect, it, vi } from "vitest";

vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

import { workspaceUserFromMemberships } from "./auth-user";
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
