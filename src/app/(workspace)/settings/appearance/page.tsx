import { AppearanceSettings } from "@/components/appearance-settings";
import { requireWorkspaceUser } from "@/lib/auth-user";

export default async function AppearancePage() {
  // Personal appearance is available to every workspace member, not just admins.
  await requireWorkspaceUser();
  return <AppearanceSettings />;
}
