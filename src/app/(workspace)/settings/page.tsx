import { SettingsScreen } from "@/components/settings-screen";
import { requireWorkspaceUser } from "@/lib/auth-user";
import { tenkiSandboxConfigured } from "@/lib/tenki-sandbox-check";
import { getWorkspaceData } from "@/lib/workspace-repository";
import { cloudflarePromptEmailConfiguration } from "@/lib/prompt-review-email";
import { getOrchestrationProviderPublicConfiguration } from "@/lib/orchestration-provider-repository";

export const dynamic = "force-dynamic";

export default async function Page() {
  const user = await requireWorkspaceUser();
  const [data, orchestration] = await Promise.all([
    getWorkspaceData(user.orgId),
    getOrchestrationProviderPublicConfiguration(user.orgId),
  ]);
  return (
    <SettingsScreen
      settings={data.settings}
      orgId={data.orgId}
      userRole={user.role}
      tenkiConfigured={tenkiSandboxConfigured()}
      promptEmailConfigured={Boolean(cloudflarePromptEmailConfiguration())}
      orchestration={orchestration}
    />
  );
}
