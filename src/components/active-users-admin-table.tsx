"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PlatformUserActions } from "./platform-user-actions";

export interface ActiveUsersAdminEntry {
  email: string;
  displayName: string;
  signInCount: number;
  firstJoinedAt: string;
  lastSignedInAt: string;
  status: "Active" | "Blocked";
  protected: boolean;
  deleteRestriction?: string;
  organizations: Array<{
    id: string;
    name: string;
    role: string;
  }>;
}

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "America/Los_Angeles",
});

export function ActiveUsersAdminTable({
  entries,
  orgId,
  canManage,
}: {
  entries: ActiveUsersAdminEntry[];
  orgId: string;
  canManage: boolean;
}) {
  const router = useRouter();
  const [notice, setNotice] = useState("");
  return (
    <>
    {notice && <p role="status">{notice}</p>}
    <section className="card table-wrap">
      <table>
        <caption className="sr-only">Active CloseSpan users</caption>
        <thead>
          <tr>
            <th>User</th>
            <th>Workspace</th>
            <th>Role</th>
            <th>Sign-ins</th>
            <th>First joined</th>
            <th>Last signed in</th>
            <th>Access</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {entries.length === 0 ? (
            <tr>
              <td className="empty" colSpan={8}>
                No active users yet.
              </td>
            </tr>
          ) : (
            entries.map((entry) => (
              <tr key={entry.email}>
                <td>
                  <strong>{entry.displayName}</strong>
                  <small>{entry.email}</small>
                </td>
                <td>
                  <strong>{entry.organizations[0]?.name ?? "Workspace"}</strong>
                  {entry.organizations.length > 1 && (
                    <small>{entry.organizations.length} workspaces</small>
                  )}
                </td>
                <td>
                  <span className="badge brand">
                    {entry.organizations[0]?.role ?? "Member"}
                  </span>
                </td>
                <td>{entry.signInCount || "—"}</td>
                <td>{dateFormatter.format(new Date(entry.firstJoinedAt))}</td>
                <td>{dateFormatter.format(new Date(entry.lastSignedInAt))}</td>
                <td><span className={`badge ${entry.status === "Blocked" ? "warning" : "success"}`}>{entry.status}</span></td>
                <td>{entry.protected ? <small>Protected account</small> : !canManage ? <small>Read-only workspace</small> :
                  <PlatformUserActions key={`${entry.email}:${entry.status}`} email={entry.email} displayName={entry.displayName} status={entry.status} orgId={orgId} deleteRestriction={entry.deleteRestriction} onComplete={(message) => { setNotice(message); router.refresh(); }} />
                }</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </section>
    </>
  );
}
