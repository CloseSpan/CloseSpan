import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cookies: vi.fn(),
  redirect: vi.fn(),
  revalidatePath: vi.fn(),
  requireWorkspaceUser: vi.fn(),
  createOrganization: vi.fn(),
  renameOrganization: vi.fn(),
  persistenceMode: "postgres" as "memory" | "postgres",
}));

vi.mock("next/headers", () => ({ cookies: mocks.cookies }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/auth-user", () => ({
  ACTIVE_ORGANIZATION_COOKIE: "active_org",
  LEGACY_ACTIVE_ORGANIZATION_COOKIE: "legacy_org",
  activeOrganizationCookieOptions: () => ({ path: "/" }),
  requireWorkspaceUser: mocks.requireWorkspaceUser,
}));
vi.mock("@/lib/organization-repository", () => ({
  createOrganization: mocks.createOrganization,
  renameOrganization: mocks.renameOrganization,
}));
vi.mock("@/lib/workspace-persistence", () => ({
  workspacePersistenceMode: () => mocks.persistenceMode,
}));

import { renameOrganizationAction } from "./organization-actions";

const adminUser = {
  id: "member_admin",
  orgId: "org_current",
  organizationName: "Current workspace",
  name: "Sam Operator",
  email: "sam@example.com",
  role: "Admin",
  organizations: [
    { id: "org_current", name: "Current workspace", role: "Admin" },
    { id: "org_other", name: "Other workspace", role: "Admin" },
  ],
};

function renameForm(name: string): FormData {
  const form = new FormData();
  form.set("workspaceName", name);
  return form;
}

describe("renameOrganizationAction", () => {
  beforeEach(() => {
    mocks.persistenceMode = "postgres";
    mocks.requireWorkspaceUser.mockReset().mockResolvedValue(adminUser);
    mocks.renameOrganization.mockReset().mockResolvedValue({
      organizationId: adminUser.orgId,
      organizationName: "Renamed workspace",
    });
    mocks.revalidatePath.mockReset();
  });

  it("renames only the authenticated active workspace and refreshes the shell", async () => {
    const result = await renameOrganizationAction(
      { error: null, success: false },
      renameForm("  Renamed workspace  "),
    );

    expect(result).toEqual({ error: null, success: true });
    expect(mocks.renameOrganization).toHaveBeenCalledWith({
      orgId: "org_current",
      name: "Renamed workspace",
      actor: {
        actorId: "member_admin",
        actorName: "Sam Operator",
        traceId: expect.stringMatching(/^workspace_rename_[a-f0-9-]{36}$/),
      },
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/", "layout");
  });

  it.each([
    ["", "Enter a workspace name"],
    ["x".repeat(121), "Workspace name must be 120 characters or fewer"],
  ])("rejects invalid workspace names", async (name, message) => {
    const result = await renameOrganizationAction(
      { error: null, success: false },
      renameForm(name),
    );

    expect(result).toEqual({ error: message, success: false });
    expect(mocks.requireWorkspaceUser).not.toHaveBeenCalled();
    expect(mocks.renameOrganization).not.toHaveBeenCalled();
  });

  it("does not allow a non-admin to rename the workspace", async () => {
    mocks.requireWorkspaceUser.mockResolvedValue({
      ...adminUser,
      role: "Contributor",
    });

    const result = await renameOrganizationAction(
      { error: null, success: false },
      renameForm("Renamed workspace"),
    );

    expect(result).toEqual({
      error: "Only workspace administrators can rename this workspace.",
      success: false,
    });
    expect(mocks.renameOrganization).not.toHaveBeenCalled();
  });

  it("does not pretend the seeded memory demo can persist a rename", async () => {
    mocks.persistenceMode = "memory";

    const result = await renameOrganizationAction(
      { error: null, success: false },
      renameForm("Renamed workspace"),
    );

    expect(result).toEqual({
      error: "The seeded demo workspace cannot be renamed.",
      success: false,
    });
    expect(mocks.renameOrganization).not.toHaveBeenCalled();
  });

  it("returns a safe retry message when persistence fails", async () => {
    mocks.renameOrganization.mockRejectedValue(new Error("database details"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await renameOrganizationAction(
      { error: null, success: false },
      renameForm("Renamed workspace"),
    );

    expect(result).toEqual({
      error: "The workspace could not be renamed right now. Please try again.",
      success: false,
    });
    expect(result.error).not.toContain("database details");
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
