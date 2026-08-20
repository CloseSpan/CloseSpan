import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { GithubAppInstallationRecord } from "@/lib/github-installation-repository";
import type { GithubRepositoryAuthorization } from "@/lib/github-repository-allowlist";
import { GithubConnectionPanel } from "./github-connection-panel";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

const installation: GithubAppInstallationRecord = {
  id: "installation-1",
  installationId: "12345",
  accountLogin: "acme",
  accountType: "Organization",
  repositorySelection: "selected",
  settingsUrl: "https://github.com/settings/installations/12345",
  active: true,
  lastSyncedAt: "2026-08-20T00:00:00.000Z",
};

function repository(
  overrides: Partial<GithubRepositoryAuthorization> = {},
): GithubRepositoryAuthorization {
  return {
    id: "repository-1",
    installationId: installation.installationId,
    repository: "acme/product",
    defaultBranch: "main",
    executionBranch: "main",
    workspaceSelected: false,
    active: true,
    ...overrides,
  };
}

describe("GithubConnectionPanel", () => {
  it("requires an explicit workspace repository choice after installation", () => {
    const markup = renderToStaticMarkup(
      <GithubConnectionPanel
        orgId="org_new"
        installations={[installation]}
        repositories={[repository()]}
        callbackStatus="connected"
        callbackReason={null}
        canManage
      />,
    );

    expect(markup).toContain("GitHub connected");
    expect(markup).toContain(
      "Choose which repositories belong to this workspace before CloseSpan starts learning them.",
    );
    expect(markup).toContain("No repositories are selected for this workspace yet.");
    expect(markup).toContain("Choose repositories for this workspace");
    expect(markup).toContain("Only repositories selected here can be profiled or used by this workspace.");
    expect(markup).toContain("acme/product");
    expect(markup).toContain("Save workspace access");
    expect(markup).toContain("<details");
    expect(markup).toContain(" open=\"\"");
  });

  it("shows only repositories selected for the current workspace as authorized", () => {
    const markup = renderToStaticMarkup(
      <GithubConnectionPanel
        orgId="org_existing"
        installations={[installation]}
        repositories={[
          repository({ workspaceSelected: true }),
          repository({
            id: "repository-2",
            repository: "acme/other-workspace",
          }),
        ]}
        callbackStatus="connected"
        callbackReason={null}
        canManage
      />,
    );

    expect(markup).toContain("Installation verified. 1 repository is selected for this workspace.");
    expect(markup.match(/acme\/product/g)).toHaveLength(2);
    expect(markup.match(/acme\/other-workspace/g)).toHaveLength(1);
    expect(markup).not.toContain(" open=\"\"");
  });

  it("does not offer repositories that are no longer accessible from GitHub", () => {
    const markup = renderToStaticMarkup(
      <GithubConnectionPanel
        orgId="org_new"
        installations={[installation]}
        repositories={[repository({ active: false })]}
        callbackStatus="connected"
        callbackReason={null}
        canManage
      />,
    );

    expect(markup).not.toContain("acme/product");
    expect(markup).toContain("No repositories are available from this installation.");
  });
});
