import { notFound } from "next/navigation";
import { ActiveUsersAdminTable } from "@/components/active-users-admin-table";
import { listActivePlatformUsers } from "@/lib/active-user-repository";
import { requireWorkspaceUser } from "@/lib/auth-user";
import { isCloseSpanPlatformAdmin, isPrivateBetaOwner } from "@/lib/workspace-access-policy";
import { readPresentationDemo } from "@/lib/presentation-demo";
import { persistenceMode } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function AdminUsersPage() {
  const user = await requireWorkspaceUser();
  if (!isCloseSpanPlatformAdmin(user)) notFound();

  const entries = await listActivePlatformUsers();
  const canManage = persistenceMode() === "postgres" && !(await readPresentationDemo(user.orgId));
  const usersWithTrackedSignIns = entries.filter(
    (entry) => entry.signInCount > 0,
  ).length;
  const workspaceCount = new Set(
    entries.flatMap((entry) => entry.organizations.map(({ id }) => id)),
  ).size;

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">Platform administration</div>
          <h1>Active users</h1>
        </div>
        <span className="badge brand">Admin only</span>
      </div>

      <div className="grid cols-3 page-metrics" aria-label="Active user summary">
        <section className="card metric">
          <div className="metric-label">Total users</div>
          <div className="metric-value">{entries.length}</div>
          <div className="metric-delta">Verified workspace members</div>
        </section>
        <section className="card metric">
          <div className="metric-label">Tracked sign-ins</div>
          <div className="metric-value">{usersWithTrackedSignIns}</div>
          <div className="metric-delta">Users seen since tracking began</div>
        </section>
        <section className="card metric">
          <div className="metric-label">Workspaces</div>
          <div className="metric-value">{workspaceCount}</div>
          <div className="metric-delta">Isolated organizations</div>
        </section>
      </div>

      <ActiveUsersAdminTable
        orgId={user.orgId}
        canManage={canManage}
        entries={entries.map((entry) => ({
          ...entry,
          protected: entry.email === user.email || isPrivateBetaOwner(entry.email),
          firstJoinedAt: entry.firstJoinedAt.toISOString(),
          lastSignedInAt: entry.lastSignedInAt.toISOString(),
        }))}
      />
    </>
  );
}
