import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireWorkspaceUser: vi.fn(),
  listPendingFeatureRequests: vi.fn(),
}));

vi.mock("@/lib/auth-user", () => ({ requireWorkspaceUser: mocks.requireWorkspaceUser }));
vi.mock("@/lib/feature-request-repository", () => ({
  listPendingFeatureRequests: mocks.listPendingFeatureRequests,
}));
vi.mock("@/components/feature-requests-board", () => ({ FeatureRequestsBoard: () => null }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("not-found"); } }));

import Page, { metadata } from "./page";

describe("Feature request moderation page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("APP_MODE", "production");
    vi.stubEnv("FEATURE_REQUEST_MODERATOR_EMAILS", "reviewer@example.com");
    vi.stubEnv("PRODUCTION_OWNER_EMAIL", "owner@example.com");
    mocks.requireWorkspaceUser.mockResolvedValue({
      role: "Admin",
      email: "reviewer@example.com",
    });
    mocks.listPendingFeatureRequests.mockResolvedValue([]);
  });

  afterEach(() => vi.unstubAllEnvs());

  it("loads the queue for an authorized moderator without requiring public Turnstile", async () => {
    const queue = [{ id: "request-1", moderationStatus: "Pending review" }];
    mocks.listPendingFeatureRequests.mockResolvedValue(queue);
    const page = await Page();
    expect(page.props).toMatchObject({
      initialRequests: [],
      initialPendingRequests: queue,
      canModerate: true,
      moderationOnly: true,
      turnstileSiteKey: "",
    });
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });

  it("requires authentication before reading any moderation data", async () => {
    mocks.requireWorkspaceUser.mockRejectedValue(new Error("sign-in-required"));
    await expect(Page()).rejects.toThrow("sign-in-required");
    expect(mocks.listPendingFeatureRequests).not.toHaveBeenCalled();
  });

  it.each([
    { role: "Admin", email: "unlisted@example.com" },
    { role: "Contributor", email: "reviewer@example.com" },
    { role: "Viewer", email: "owner@example.com" },
  ])("rejects unauthorized users before loading the queue: $role $email", async (user) => {
    mocks.requireWorkspaceUser.mockResolvedValue(user);
    await expect(Page()).rejects.toThrow("not-found");
    expect(mocks.listPendingFeatureRequests).not.toHaveBeenCalled();
  });

  it("accepts the configured production owner with the Admin role", async () => {
    mocks.requireWorkspaceUser.mockResolvedValue({ role: "Admin", email: "owner@example.com" });
    await Page();
    expect(mocks.listPendingFeatureRequests).toHaveBeenCalledOnce();
  });

  it("fails closed when production has no configured moderators", async () => {
    vi.stubEnv("FEATURE_REQUEST_MODERATOR_EMAILS", "");
    vi.stubEnv("PRODUCTION_OWNER_EMAIL", "");
    await expect(Page()).rejects.toThrow("not-found");
    expect(mocks.listPendingFeatureRequests).not.toHaveBeenCalled();
  });
});
