import { AppShell } from "@/components/app-shell";
import { requireWorkspaceUser } from "@/lib/auth-user";

export const dynamic = "force-dynamic";

export default async function WorkspaceLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const user = await requireWorkspaceUser();
  return <AppShell user={user}>{children}</AppShell>;
}
