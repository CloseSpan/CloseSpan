import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ headers: vi.fn(), user: vi.fn() }));
vi.mock("next/headers", () => ({ headers: mocks.headers }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("not-found"); } }));
vi.mock("@/lib/auth-user", () => ({ requireWorkspaceUser: mocks.user }));
vi.mock("@/app/auth-actions", () => ({ signOutCurrentUser: async () => {} }));
import Page from "./page";

describe("workspace reset page", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("CLOSESPAN_UI_RESET", "true");
    mocks.headers.mockResolvedValue(new Headers({ host: "localhost:3000" }));
    mocks.user.mockReset().mockResolvedValue({ orgId: "org-1" });
  });
  afterEach(() => vi.unstubAllEnvs());

  it("keeps only the reset state and sign-out action after workspace authentication", async () => {
    const html = renderToStaticMarkup(await Page());
    expect(mocks.user).toHaveBeenCalledOnce();
    expect(html).toContain("Workspace reset");
    expect(html).toContain("Sign out");
    expect(html).toContain('data-gooey="off"');
    for (const oldUi of ["sidebar", "app-shell", "Approve", "Test sandbox", "Prompt Testing", "<nav", "<a "]) {
      expect(html).not.toContain(oldUi);
    }
  });

  it("preserves authentication failure instead of rendering the reset", async () => {
    mocks.user.mockRejectedValue(new Error("sign-in-required"));
    await expect(Page()).rejects.toThrow("sign-in-required");
  });

  it.each(["production", "test"])("does not expose a direct reset route in %s", async (mode) => {
    vi.stubEnv("NODE_ENV", mode);
    await expect(Page()).rejects.toThrow("not-found");
    expect(mocks.user).not.toHaveBeenCalled();
  });

  it.each(["app.closespan.com", "localhost.example.com", "", "/"])("does not expose reset UI on host %s", async (host) => {
    mocks.headers.mockResolvedValue(new Headers({ host }));
    await expect(Page()).rejects.toThrow("not-found");
    expect(mocks.user).not.toHaveBeenCalled();
  });

  it("does not expose the reset route after restoring the previous UI", async () => {
    vi.stubEnv("CLOSESPAN_UI_RESET", "false");
    await expect(Page()).rejects.toThrow("not-found");
    expect(mocks.user).not.toHaveBeenCalled();
  });
});
