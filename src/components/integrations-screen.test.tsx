import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { IntegrationsScreen } from "./screens";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

describe("IntegrationsScreen", () => {
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
