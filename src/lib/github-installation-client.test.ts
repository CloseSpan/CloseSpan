import { afterEach, describe, expect, it, vi } from "vitest";
import { requestGithubInstallUrl } from "./github-installation-client";

describe("requestGithubInstallUrl", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("starts GitHub App setup for the current workspace", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({ installUrl: "https://github.com/apps/closespan/installations/new?state=signed" }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(requestGithubInstallUrl("org_test")).resolves.toBe(
      "https://github.com/apps/closespan/installations/new?state=signed",
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/integrations/github",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "x-org-id": "org_test" }),
      }),
    );
  });

  it("surfaces the server error instead of leaving the button inert", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(
        { error: "Administrator permission is required" },
        { status: 403 },
      )),
    );

    await expect(requestGithubInstallUrl("org_test")).rejects.toThrow(
      "Administrator permission is required",
    );
  });
});
