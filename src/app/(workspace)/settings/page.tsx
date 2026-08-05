import { SettingsScreen } from "@/components/settings-screen";
import { requireWorkspaceUser } from "@/lib/auth-user";
import { tenkiSandboxConfigured } from "@/lib/tenki-sandbox-check";
import { getWorkspaceData } from "@/lib/workspace-repository";
import { cloudflarePromptEmailConfiguration } from "@/lib/prompt-review-email";
import { getBillingShadowStatus } from "@/lib/billing-outbox";

export const dynamic = "force-dynamic";

export default async function Page() {
  const user = await requireWorkspaceUser();
  const [data, billingStatus] = await Promise.all([
    getWorkspaceData(user.orgId),
    getBillingShadowStatus(user.orgId),
  ]);
  return (
    <SettingsScreen
      settings={data.settings}
      orgId={data.orgId}
      userRole={user.role}
      tenkiConfigured={tenkiSandboxConfigured()}
      promptEmailConfigured={Boolean(cloudflarePromptEmailConfiguration())}
      billingStatus={billingStatus}
    />
  );
}
