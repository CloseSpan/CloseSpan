export interface ActiveUsersAdminEntry {
  email: string;
  displayName: string;
  signInCount: number;
  firstJoinedAt: string;
  lastSignedInAt: string;
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
}: {
  entries: ActiveUsersAdminEntry[];
}) {
  return (
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
          </tr>
        </thead>
        <tbody>
          {entries.length === 0 ? (
            <tr>
              <td className="empty" colSpan={6}>
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
              </tr>
            ))
          )}
        </tbody>
      </table>
    </section>
  );
}
