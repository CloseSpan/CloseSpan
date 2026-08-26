import { notFound, redirect } from "next/navigation";
import { requireWorkspaceUser } from "@/lib/auth-user";
import { isCloseSpanPlatformAdmin } from "@/lib/workspace-access-policy";

export const dynamic = "force-dynamic";

export default async function LegacyAdminWaitlistPage() {
  const user = await requireWorkspaceUser();
  if (!isCloseSpanPlatformAdmin(user)) notFound();
  redirect("/admin/users");
}
