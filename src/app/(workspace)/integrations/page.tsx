import { IntegrationsScreen } from "@/components/screens";
import { GithubConnectionPanel } from "@/components/github-connection-panel";
import { requireWorkspaceUser } from "@/lib/auth-user";
import { listGithubAppInstallations } from "@/lib/github-installation-repository";
import { listGithubRepositoryAuthorizations } from "@/lib/github-repository-allowlist";
import { integrationCatalog } from "@/lib/integration-catalog";
import { getOnboardingState } from "@/lib/onboarding-repository";
import { listPipedreamConnections } from "@/lib/pipedream-repository";
import { getWorkspaceData } from "@/lib/workspace-repository";

export const dynamic = "force-dynamic";

const focusableIntegrationIds = new Set(
  integrationCatalog.map((integration) => integration.id),
);

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{
    focus?: string | string[];
    view?: string | string[];
    github?: string | string[];
    discord?: string | string[];
    reason?: string | string[];
  }>;
}) {
  const user = await requireWorkspaceUser();
  const [data, onboarding, pipedreamConnections, githubRepositories, params] = await Promise.all([
    getWorkspaceData(user.orgId),
    getOnboardingState(user.orgId),
    listPipedreamConnections(user.orgId),
    listGithubRepositoryAuthorizations(user.orgId),
    searchParams,
  ]);
  const requestedFocus = Array.isArray(params.focus)
    ? params.focus[0]
    : params.focus;
  const focusedIntegrationId =
    requestedFocus && focusableIntegrationIds.has(requestedFocus)
      ? requestedFocus
      : null;
  const requestedView = Array.isArray(params.view)
    ? params.view[0]
    : params.view;
  const initialView: "suggestions" | "connections" = focusedIntegrationId
    ? "connections"
    : requestedView === "connections"
      ? "connections"
      : "suggestions";
  const callbackStatus = Array.isArray(params.github) ? params.github[0] : params.github;
  const discordCallbackStatus = Array.isArray(params.discord) ? params.discord[0] : params.discord;
  const callbackReason = Array.isArray(params.reason) ? params.reason[0] : params.reason;
  const showGithubConnection =
    focusedIntegrationId === "int_github" || callbackStatus === "connected" || callbackStatus === "error";
  const githubInstallations = showGithubConnection
    ? await listGithubAppInstallations(user.orgId)
    : [];
  const initialIntegrationActivity = pipedreamConnections.map(
    ({
      integrationId,
      accountName,
      state,
      healthy,
      lastImportAt,
      lastImportStatus,
      lastImportCount,
    }) => ({
      integrationId,
      accountName,
      state,
      healthy,
      lastImportAt,
      lastImportStatus,
      lastImportCount,
    }),
  );

  return (
    <>
      {showGithubConnection && (
        <GithubConnectionPanel
          orgId={user.orgId}
          installations={githubInstallations}
          repositories={githubRepositories}
          callbackStatus={callbackStatus ?? null}
          callbackReason={callbackReason ?? null}
          canManage={user.role === "Admin"}
        />
      )}
      <IntegrationsScreen
        integrations={data.integrations}
        githubRepositories={githubRepositories}
        orgId={user.orgId}
        focusedIntegrationId={focusedIntegrationId}
        productName={onboarding.productProfile.productName}
        recommendedConnectors={onboarding.recommendedConnectors}
        initialIntegrationActivity={initialIntegrationActivity}
        initialView={initialView}
        discordCallbackStatus={discordCallbackStatus ?? null}
        discordCallbackReason={callbackReason ?? null}
      />
    </>
  );
}
