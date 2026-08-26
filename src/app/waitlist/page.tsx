import { redirect } from "next/navigation";
import { resolveWorkspaceAccess } from "@/lib/auth-user";

export const dynamic = "force-dynamic";

export default async function WaitlistPage() {
  const access = await resolveWorkspaceAccess();
  if (access.status === "unauthenticated") redirect("/login");
  if (access.status === "unavailable")
    redirect("/login?error=WorkspaceUnavailable");
  redirect("/overview");
}
