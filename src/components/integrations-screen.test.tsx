import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { IntegrationsScreen } from "./screens";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

describe("IntegrationsScreen", () => {
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
