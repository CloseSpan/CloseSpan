import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { IntegrationsScreen } from "./screens";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

describe("IntegrationsScreen", () => {
  const settingsProps: Parameters<typeof IntegrationsScreen>[0] = {
    mode: "settings", orgId: "org_test", productName: null, recommendedConnectors: [],
    initialIntegrationActivity: [], initialView: "connections", githubRepositories: [],
    integrations: [
      { id: "int_retell", name: "Retell AI", category: "Feedback", state: "Connected", lastSync: null, dataScope: "Calls", permissions: ["calls:read"] },
      { id: "int_slack", name: "Slack", category: "Feedback", state: "Needs reconnect", lastSync: null, dataScope: "Channels", permissions: [] },
      { id: "int_github", name: "GitHub", category: "Engineering", state: "Disconnected", lastSync: null, dataScope: "Repositories", permissions: [] },
      { id: "int_linear", name: "Linear", category: "Engineering", state: "Not connected", lastSync: null, dataScope: "Issues", permissions: [] },
    ],
  };

  it("shows only existing connections in settings, including expired authorizations", () => {
    const markup = renderToStaticMarkup(<IntegrationsScreen {...settingsProps} />);
    expect(markup).toContain('>Connections</h1>');
    expect(markup).toContain("View Retell AI connection details");
    expect(markup).toContain("View Slack connection details");
    expect(markup).toContain("Needs reconnect");
    expect(markup).not.toContain("View GitHub connection details");
    expect(markup).not.toContain("Linear");
    expect(markup).not.toContain("Suggestions");
    expect(markup).not.toContain("Recommended");
    expect(markup).toContain("Synchronization health");
    expect(markup).toContain("1 needs attention");
    expect(markup).toContain('aria-label="All connections, 2" aria-pressed="true"');
    expect(markup).toContain('aria-label="Feedback connections, 2"');
    expect(markup).toContain('aria-label="Engineering connections, 0"');
    expect(markup).toContain('aria-label="Analytics connections, 0"');
    expect(markup).toContain('aria-label="Support connections, 0"');
    expect(markup.match(/class="integration-summary-card"/g)).toHaveLength(4);
    expect(markup).not.toContain('role="tablist"');
    expect(markup).toContain('class="integrations-grid"');
    expect(markup.match(/class="card integration"/g)).toHaveLength(2);
    expect(markup.match(/class="integration-card-footer"/g)).toHaveLength(2);
    expect(markup).not.toContain('class="settings-connection-row"');
  });

  it("keeps a GitHub installation manageable before repositories have been selected", () => {
    const markup = renderToStaticMarkup(<IntegrationsScreen {...settingsProps} githubInstalled canManageConnections focusedIntegrationId="int_github" />);
    expect(markup).toContain("View GitHub connection details");
    expect(markup).toContain("Disconnect GitHub");
    expect(markup).not.toContain("Manage repositories");
    expect(markup).not.toContain("Select repositories");
  });

  it("does not expose connection mutations to non-administrators", () => {
    const markup = renderToStaticMarkup(<IntegrationsScreen {...settingsProps} githubInstalled focusedIntegrationId="int_github" />);
    expect(markup).toContain("Only workspace administrators");
    expect(markup).not.toContain("Disconnect GitHub");
  });

  it("provides an honest empty state without a recommended catalog", () => {
    const markup = renderToStaticMarkup(<IntegrationsScreen {...settingsProps} integrations={[]} />);
    expect(markup).toContain("No connected tools");
    expect(markup).toContain("Browse integrations");
    expect(markup).not.toContain("Healthy");
  });

  it("keeps demo connections explicitly simulated and read-only", () => {
    const markup = renderToStaticMarkup(<IntegrationsScreen {...settingsProps} integrations={[{ ...settingsProps.integrations[0], state: "Demo connected" }]} focusedIntegrationId="int_retell" canManageConnections />);
    expect(markup).toContain("Demo connection");
    expect(markup).toContain("no OAuth credential or external request is used");
    expect(markup).not.toContain("Disconnect");
  });
  it.each(["Connected", "Disconnected"] as const)("keeps %s connector details in the shared spaced stack", (state) => {
    const markup = renderToStaticMarkup(
      <IntegrationsScreen
        integrations={[{
          id: "int_github",
          name: "GitHub",
          category: "Engineering",
          state,
          lastSync: null,
          dataScope: "Selected repositories",
          permissions: ["contents:read"],
        }]}
        githubRepositories={state === "Connected" ? [{
          id: "repo_1",
          installationId: "installation_1",
          repository: "example/product",
          defaultBranch: "main",
          executionBranch: "main",
          workspaceSelected: true,
          active: true,
        }] : []}
        orgId="org_test"
        focusedIntegrationId="int_github"
        productName="CloseSpan"
        recommendedConnectors={[]}
        initialIntegrationActivity={[]}
        initialView="connections"
      />,
    );
    const drawer = markup.slice(markup.indexOf('<div class="integration-drawer-content">'), markup.indexOf("</aside>"));
    expect(drawer).toContain('class="integration-drawer-summary"');
    expect(drawer.match(/class="integration-drawer-section"/g)).toHaveLength(state === "Connected" ? 3 : 2);
    expect(drawer).toContain('class="integration-drawer-actions"');
    expect(drawer.endsWith("</div>")).toBe(true);
  });

  it("counts an authorized GitHub repository as a live connection", () => {
    const markup = renderToStaticMarkup(
      <IntegrationsScreen
        integrations={[
          {
            id: "int_slack",
            name: "Slack",
            category: "Feedback",
            state: "Connected",
            lastSync: "2026-08-18T20:00:00.000Z",
            dataScope: "Selected channels",
            permissions: [],
          },
          {
            id: "int_github",
            name: "GitHub",
            category: "Engineering",
            state: "Disconnected",
            lastSync: null,
            dataScope: "Selected repositories",
            permissions: [],
          },
        ]}
        githubRepositories={[
          {
            id: "repo_1",
            installationId: "installation_1",
            repository: "samshanmukh/zup",
            defaultBranch: "main",
            executionBranch: "main",
            workspaceSelected: true,
            active: true,
          },
        ]}
        orgId="org_test"
        productName="CloseSpan"
        recommendedConnectors={[]}
        initialIntegrationActivity={[]}
        initialView="connections"
      />,
    );

    expect(markup).toContain(">Connections<span>2</span>");
  });
});
