import type { ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { GithubAppInstallationRecord } from "@/lib/github-installation-repository";
import type { GithubRepositoryAuthorization } from "@/lib/github-repository-allowlist";
import {
  buildGithubConnectionChoices,
  OnboardingGithubPicker,
  OnboardingGithubStep,
  type GithubConnectionChoice,
} from "./onboarding-github-step";

function installation(overrides: Partial<GithubAppInstallationRecord> = {}): GithubAppInstallationRecord {
  return {
    id: "installation-current", installationId: "123", accountLogin: "current-team",
    accountType: "Organization", repositorySelection: "selected",
    settingsUrl: "https://github.com/organizations/current-team/settings/installations/123",
    active: true, lastSyncedAt: "2026-09-06T12:00:00Z", ...overrides,
  };
}

function repository(overrides: Partial<GithubRepositoryAuthorization> = {}): GithubRepositoryAuthorization {
  return {
    id: "repo-selected", installationId: "123", repository: "current-team/product",
    defaultBranch: "main", executionBranch: "main", workspaceSelected: true, active: true,
    ...overrides,
  };
}

const choice: GithubConnectionChoice = {
  installationId: "123", accountLogin: "current-team", reusable: false,
  repositories: [
    { repository: "current-team/product", defaultBranch: "main", selected: true },
    { repository: "current-team/docs", defaultBranch: "main", selected: false },
  ],
};

function render(overrides: Partial<ComponentProps<typeof OnboardingGithubPicker>> = {}) {
  return renderToStaticMarkup(<OnboardingGithubPicker
    choices={[choice]} installationId="123" selected={new Set(["current-team/product"])}
    query="" loading={false} busy={null} error={null} canManage continuing={false}
    onAccountChange={vi.fn()} onSelectionChange={vi.fn()} onQueryChange={vi.fn()}
    onSave={vi.fn()} onConnect={vi.fn()} onRetry={vi.fn()} onCancel={vi.fn()} onContinue={vi.fn()}
    {...overrides}
  />);
}

function buttonAttributes(html: string, label: string): string | undefined {
  return html.match(new RegExp(`<button([^>]*)>${label}</button>`))?.[1];
}

describe("GitHub onboarding connection choices", () => {
  it("preserves current workspace selections without including inactive or unrelated repositories", () => {
    const installations = [installation(), installation({ installationId: "456", active: false })];
    const repositories = [
      repository(),
      repository({ id: "repo-unselected", repository: "current-team/docs", workspaceSelected: false }),
      repository({ id: "repo-disabled", repository: "current-team/disabled", active: false }),
      repository({ id: "repo-inactive-install", installationId: "456", repository: "inactive/product" }),
      repository({ id: "repo-other-install", installationId: "789", repository: "other/product" }),
    ];

    expect(buildGithubConnectionChoices(installations, repositories, [])).toEqual([choice]);
  });

  it("starts reusable connections with no repository access selected", () => {
    const reusable = [{
      installationId: "789", accountLogin: "other-team",
      repositories: [{ repository: "other-team/product", defaultBranch: "develop", selected: true }],
    }];
    const choices = buildGithubConnectionChoices([], [], reusable);

    expect(choices).toEqual([{
      installationId: "789", accountLogin: "other-team", reusable: true,
      repositories: [{ repository: "other-team/product", defaultBranch: "develop", selected: false }],
    }]);
    expect(reusable[0].repositories[0].selected).toBe(true);
  });

  it("deduplicates reusable installation IDs and prefers the current workspace's repository scope", () => {
    const reusable = [
      { installationId: "123", accountLogin: "current-team", repositories: [{ repository: "current-team/not-in-this-workspace", defaultBranch: "main" }] },
      { installationId: "789", accountLogin: "other-team", repositories: [{ repository: "other-team/product", defaultBranch: "main" }] },
      { installationId: "789", accountLogin: "other-team", repositories: [{ repository: "other-team/duplicate", defaultBranch: "main" }] },
    ];
    const choices = buildGithubConnectionChoices([installation()], [repository()], reusable);

    expect(choices.map((item) => item.installationId)).toEqual(["123", "789"]);
    expect(choices[0].reusable).toBe(false);
    expect(choices[0].repositories).toEqual([{ repository: "current-team/product", defaultBranch: "main", selected: true }]);
    expect(choices[1].repositories).toEqual([{ repository: "other-team/product", defaultBranch: "main", selected: false }]);
  });

  it("returns no choices when there are no active or reusable connections", () => {
    expect(buildGithubConnectionChoices([installation({ active: false })], [repository()], [])).toEqual([]);
  });
});

describe("GitHub onboarding picker", () => {
  it("offers repository selection for an existing connection instead of reconnecting", () => {
    const html = render();
    expect(html).toContain(">Choose repositories</h2>");
    expect(html).toContain("GitHub connected");
    expect(html).toContain("current-team");
    expect(html).toContain('checked=""');
    expect(html.match(/checked=""/g)).toHaveLength(1);
    expect(buttonAttributes(html, "Use selected repositories")).not.toContain("disabled");
    expect(buttonAttributes(html, "Manage GitHub access")).toBeDefined();
    expect(buttonAttributes(html, "Continue to workspace")).toBeDefined();
    expect(buttonAttributes(html, "Connect GitHub")).toBeUndefined();
    expect(html).not.toContain("<details");
  });

  it("requires an explicit selection for a reusable connection", () => {
    const choices = buildGithubConnectionChoices([], [], [{
      installationId: "789", accountLogin: "other-team",
      repositories: [{ repository: "other-team/product", defaultBranch: "main" }],
    }]);
    const html = render({ choices, installationId: "789", selected: new Set() });
    expect(html).toContain("other-team/product");
    expect(html).not.toContain('checked=""');
    expect(buttonAttributes(html, "Use selected repositories")).toContain("disabled");
  });

  it("shows only the selected account's repositories", () => {
    const html = render({ choices: [choice, {
      installationId: "789", accountLogin: "other-team", reusable: true,
      repositories: [{ repository: "other-team/product", defaultBranch: "main", selected: false }],
    }] });
    expect(html).toContain('aria-label="GitHub account"');
    expect(html).toContain("current-team/product");
    expect(html).not.toContain("other-team/product");
  });

  it("does not flash Connect GitHub or selectable repositories while loading", () => {
    const html = render({ loading: true });
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("Checking GitHub…");
    expect(html).toContain("Loading repositories…");
    expect(html).not.toContain("Connect GitHub");
    expect(html).not.toContain("GitHub connected");
    expect(html).not.toContain('type="checkbox"');
    expect(buttonAttributes(html, "Use selected repositories")).toBeUndefined();
    expect(buttonAttributes(html, "Continue to workspace")).toContain("disabled");
  });

  it("initially renders the live step as checking rather than disconnected", () => {
    const html = renderToStaticMarkup(<OnboardingGithubStep orgId="workspace-new" canManage
      onConnectionChange={async () => undefined} onContinue={vi.fn()} continuing={false} />);
    expect(html).toContain("Checking GitHub…");
    expect(html).not.toContain("Connect GitHub");
    expect(html).not.toContain("Choose repositories");
  });

  it("offers connection and workspace continuation when no connection exists", () => {
    const html = render({ choices: [], installationId: "", selected: new Set() });
    expect(html).toContain(">Connect GitHub</h2>");
    expect(buttonAttributes(html, "Connect GitHub")).toBeDefined();
    expect(buttonAttributes(html, "Continue to workspace")).not.toContain("disabled");
    expect(buttonAttributes(html, "Use selected repositories")).toBeUndefined();
  });

  it("provides visible errors and a retry action", () => {
    const html = render({ error: "GitHub is temporarily unavailable." });
    expect(html).toContain('role="alert"');
    expect(html).toContain("GitHub is temporarily unavailable.");
    expect(buttonAttributes(html, "Try again")).not.toContain("disabled");
  });

  it("does not expose management controls to non-admin members", () => {
    const html = render({ canManage: false });
    expect(html).toContain("Ask a workspace admin to choose repositories.");
    expect(html).not.toContain('type="checkbox"');
    for (const label of ["Use selected repositories", "Manage GitHub access", "Connect GitHub"]) {
      expect(buttonAttributes(html, label)).toBeUndefined();
    }
    expect(buttonAttributes(html, "Continue to workspace")).not.toContain("disabled");
  });

  it("explains an empty connection and disables saving without repositories", () => {
    const html = render({ choices: [{ ...choice, repositories: [] }], selected: new Set() });
    expect(html).toContain("No repositories available.");
    expect(html).toContain("Update repository access in GitHub.");
    expect(buttonAttributes(html, "Use selected repositories")).toContain("disabled");
    expect(buttonAttributes(html, "Manage GitHub access")).toBeDefined();
  });

  it("searches long repository lists case-insensitively without clearing hidden selections", () => {
    const many: GithubConnectionChoice = { ...choice, repositories: Array.from({ length: 6 }, (_, index) => ({
      repository: `current-team/project-${index}`, defaultBranch: "main", selected: index === 0,
    })) };
    const html = render({ choices: [many], query: " PROJECT-3 ", selected: new Set(["current-team/project-0"]) });
    expect(html).toContain('type="search"');
    expect(html).toContain('aria-label="Find a repository"');
    expect(html).toContain("current-team/project-3");
    expect(html).not.toContain("current-team/project-0");
    expect(buttonAttributes(html, "Use selected repositories")).not.toContain("disabled");
    const noMatches = render({ choices: [many], query: "not-present" });
    expect(noMatches).toContain("No matching repositories.");
    expect(noMatches).not.toContain('type="checkbox"');
  });

  it("omits search for short lists", () => {
    expect(render()).not.toContain('type="search"');
  });

  it("disables duplicate saves and connection changes while saving", () => {
    const html = render({ busy: "save" });
    expect(buttonAttributes(html, "Connecting…")).toContain("disabled");
    expect(buttonAttributes(html, "Manage GitHub access")).toContain("disabled");
    expect(buttonAttributes(html, "Continue to workspace")).toContain("disabled");
    expect(html).toContain('<fieldset class="onboarding-github-repositories" disabled="">');
  });

  it("allows canceling the popup while other actions are disabled", () => {
    const html = render({ busy: "connect" });
    expect(buttonAttributes(html, "Connecting in popup…")).toContain("disabled");
    expect(buttonAttributes(html, "Use selected repositories")).toContain("disabled");
    expect(buttonAttributes(html, "Cancel")).not.toContain("disabled");
  });

  it("disables actions while navigating to the workspace", () => {
    const html = render({ continuing: true });
    expect(buttonAttributes(html, "Opening workspace…")).toContain("disabled");
    expect(buttonAttributes(html, "Use selected repositories")).toContain("disabled");
    expect(buttonAttributes(html, "Manage GitHub access")).toContain("disabled");
  });
});
