import { describe, expect, it, vi } from "vitest";
import type { Octokit } from "@octokit/rest";
import { parseGithubInstallationId, verifyGithubInstallation } from "./github-app-auth";

function clients(input?: { contents?: "read" | "write"; pulls?: "read" | "write" }) {
  const app = {
    rest: {
      apps: {
        getInstallation: vi.fn().mockResolvedValue({
          data: {
            id: 150109806,
            account: { id: 42, login: "acme" },
            target_type: "Organization",
            repository_selection: "selected",
            html_url: "https://github.com/organizations/acme/settings/installations/150109806",
            suspended_at: null,
            permissions: {
              contents: input?.contents ?? "write",
              pull_requests: input?.pulls ?? "write",
              metadata: "read",
            },
          },
        }),
      },
    },
  };
  const installation = {
    rest: { apps: { listReposAccessibleToInstallation: vi.fn() } },
    paginate: vi.fn().mockResolvedValue([
      { full_name: "acme/widget", default_branch: "main", private: true },
      { full_name: "acme/api", default_branch: "master", private: false },
    ]),
  };
  return {
    app: app as unknown as Octokit,
    installation: installation as unknown as Octokit,
  };
}

describe("GitHub App installation verification", () => {
  it("verifies required permissions and normalizes selected repositories", async () => {
    await expect(verifyGithubInstallation("150109806", clients())).resolves.toMatchObject({
      installationId: "150109806",
      accountLogin: "acme",
      accountType: "Organization",
      repositories: [
        { repository: "acme/api", defaultBranch: "master" },
        { repository: "acme/widget", defaultBranch: "main" },
      ],
    });
  });

  it("rejects unsafe IDs and insufficient write permissions", async () => {
    expect(() => parseGithubInstallationId("150109806x")).toThrow("valid GitHub App installation ID");
    await expect(
      verifyGithubInstallation("150109806", clients({ contents: "read" })),
    ).rejects.toThrow("Contents and Pull requests read/write");
  });
});
