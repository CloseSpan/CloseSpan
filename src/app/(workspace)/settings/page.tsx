import { SettingsScreen } from "@/components/settings-screen";
import { requireWorkspaceUser } from "@/lib/auth-user";
import { tenkiSandboxConfigured } from "@/lib/tenki-sandbox-check";
import { getWorkspaceData } from "@/lib/workspace-repository";

export const dynamic = "force-dynamic";

export default async function Page() {
  const user = await requireWorkspaceUser();
  const data = await getWorkspaceData(user.orgId);
  return (
    <SettingsScreen
      settings={data.settings}
      orgId={data.orgId}
      userRole={user.role}
      tenkiConfigured={tenkiSandboxConfigured()}
    />
  );
}
