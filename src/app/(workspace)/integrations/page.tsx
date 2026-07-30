import { IntegrationsScreen } from "@/components/screens";
import { requireWorkspaceUser } from "@/lib/auth-user";
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
  }>;
}) {
  const user = await requireWorkspaceUser();
  const [data, onboarding, pipedreamConnections, params] = await Promise.all([
    getWorkspaceData(user.orgId),
    getOnboardingState(user.orgId),
    listPipedreamConnections(user.orgId),
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
    <IntegrationsScreen
      integrations={data.integrations}
      orgId={user.orgId}
      focusedIntegrationId={focusedIntegrationId}
      productName={onboarding.productProfile.productName}
      recommendedConnectors={onboarding.recommendedConnectors}
      initialIntegrationActivity={initialIntegrationActivity}
      initialView={initialView}
    />
  );
}
