import { IntegrationsScreen } from "@/components/screens";
import { requireWorkspaceUser } from "@/lib/auth-user";
import { listGithubAppInstallations } from "@/lib/github-installation-repository";
import { listGithubRepositoryAuthorizations } from "@/lib/github-repository-allowlist";
import { getWorkspaceData } from "@/lib/workspace-repository";

export const dynamic = "force-dynamic";

export default async function ConnectionsPage() {
  const user = await requireWorkspaceUser();
  const [data, repositories, installations] = await Promise.all([
    getWorkspaceData(user.orgId),
    listGithubRepositoryAuthorizations(user.orgId),
    listGithubAppInstallations(user.orgId),
  ]);

  return (
    <IntegrationsScreen
      key={user.orgId}
      mode="settings"
      integrations={data.integrations}
      githubRepositories={repositories}
      githubInstalled={installations.some((installation) => installation.active)}
      canManageConnections={user.role === "Admin"}
      orgId={user.orgId}
      productName={null}
      recommendedConnectors={[]}
      initialIntegrationActivity={[]}
      initialView="connections"
    />
  );
}
