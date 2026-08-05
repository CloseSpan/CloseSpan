import { notFound } from "next/navigation";
import { requireWorkspaceUser } from "@/lib/auth-user";
import { listWorkspaceAccessWaitlist } from "@/lib/access-waitlist-repository";
import { isCloseSpanPlatformAdmin } from "@/lib/workspace-access-policy";
import { WaitlistAdminTable } from "@/components/waitlist-admin-table";

export const dynamic = "force-dynamic";

export default async function AdminWaitlistPage() {
  const user = await requireWorkspaceUser();
  if (!isCloseSpanPlatformAdmin(user)) notFound();

  const entries = await listWorkspaceAccessWaitlist();
  const pending = entries.filter((entry) => entry.status === "Pending").length;
  const approved = entries.filter((entry) => entry.status === "Approved").length;
  const attempts = entries.reduce(
    (total, entry) => total + entry.loginAttemptCount,
    0,
  );

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">Platform administration</div>
          <h1>Waitlist users</h1>
          <p className="subtle">
            Verified users who requested access to the CloseSpan private beta.
          </p>
        </div>
        <span className="badge brand">Admin only</span>
      </div>

      <div className="grid cols-3 page-metrics" aria-label="Waitlist summary">
        <section className="card metric">
          <div className="metric-label">Total users</div>
          <div className="metric-value">{entries.length}</div>
          <div className="metric-delta">All recorded requests</div>
        </section>
        <section className="card metric">
          <div className="metric-label">Pending</div>
          <div className="metric-value">{pending}</div>
          <div className="metric-delta">Waiting for access</div>
        </section>
        <section className="card metric">
          <div className="metric-label">Approved</div>
          <div className="metric-value">{approved}</div>
          <div className="metric-delta">{attempts} total login attempts</div>
        </section>
      </div>

      <WaitlistAdminTable
        orgId={user.orgId}
        entries={entries.map((entry) => ({
          ...entry,
          firstAttemptedAt: entry.firstAttemptedAt.toISOString(),
          lastAttemptedAt: entry.lastAttemptedAt.toISOString(),
        }))}
      />
    </>
  );
}
