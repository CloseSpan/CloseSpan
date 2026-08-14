import { describe, expect, it, vi } from "vitest";
import { resolveAuthorizedGithubBranchHead } from "./github-repository-allowlist";

describe("authorized GitHub branch heads", () => {
  it("uses the live selected-branch SHA instead of cached profile evidence", async () => {
    const getRef = vi.fn().mockResolvedValue({
      data: { object: { sha: "A502ABFF8A32A06DD1D0D30521BCDA5D1F4032F1" } },
    });

    await expect(resolveAuthorizedGithubBranchHead({
      orgId: "org-1",
      repository: "samshanmukh/zup",
    }, {
      listAuthorizations: async () => [{
        id: "repo-1",
        installationId: "123",
        repository: "samshanmukh/zup",
        defaultBranch: "main",
        executionBranch: "main",
        workspaceSelected: true,
        active: true,
      }],
      createInstallationClient: async () => ({ rest: { git: { getRef } } }),
    })).resolves.toEqual({
      repository: "samshanmukh/zup",
      branch: "main",
      sha: "a502abff8a32a06dd1d0d30521bcda5d1f4032f1",
    });
    expect(getRef).toHaveBeenCalledWith({
      owner: "samshanmukh",
      repo: "zup",
      ref: "heads/main",
    });
  });

  it("refuses to read a repository that is not active and selected", async () => {
    await expect(resolveAuthorizedGithubBranchHead({
      orgId: "org-1",
      repository: "samshanmukh/zup",
      branch: "main",
    }, {
      listAuthorizations: async () => [],
    })).rejects.toThrow("no longer authorized");
  });

  it("refuses a branch other than the workspace-selected execution branch", async () => {
    await expect(resolveAuthorizedGithubBranchHead({
      orgId: "org-1",
      repository: "samshanmukh/zup",
      branch: "release",
    }, {
      listAuthorizations: async () => [{
        id: "repo-1",
        installationId: "123",
        repository: "samshanmukh/zup",
        defaultBranch: "main",
        executionBranch: "main",
        workspaceSelected: true,
        active: true,
      }],
    })).rejects.toThrow("not the branch selected");
  });
});
