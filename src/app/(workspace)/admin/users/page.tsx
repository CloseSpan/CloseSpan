import { notFound } from "next/navigation";
import { ActiveUsersAdminTable } from "@/components/active-users-admin-table";
import { listActivePlatformUsers } from "@/lib/active-user-repository";
import { requireWorkspaceUser } from "@/lib/auth-user";
import { isCloseSpanPlatformAdmin } from "@/lib/workspace-access-policy";

export const dynamic = "force-dynamic";

export default async function AdminUsersPage() {
  const user = await requireWorkspaceUser();
  if (!isCloseSpanPlatformAdmin(user)) notFound();

  const entries = await listActivePlatformUsers();
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
          <p className="subtle">
            Verified users with a CloseSpan workspace and their sign-in
            activity.
          </p>
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
        entries={entries.map((entry) => ({
          ...entry,
          firstJoinedAt: entry.firstJoinedAt.toISOString(),
          lastSignedInAt: entry.lastSignedInAt.toISOString(),
        }))}
      />
    </>
  );
}
