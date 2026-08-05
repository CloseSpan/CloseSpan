"use client";

import { Check, Mail, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

export interface WaitlistAdminEntry {
  email: string;
  displayName: string | null;
  status: "Pending" | "Approved" | "Declined";
  loginAttemptCount: number;
  firstAttemptedAt: string;
  lastAttemptedAt: string;
}

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "America/Los_Angeles",
});

function statusClass(status: WaitlistAdminEntry["status"]): string {
  if (status === "Approved") return "badge success";
  if (status === "Declined") return "badge high";
  return "badge medium";
}

export function WaitlistAdminTable({ entries, orgId }: { entries: WaitlistAdminEntry[]; orgId: string }) {
  const router = useRouter();
  const [busyEmail, setBusyEmail] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  async function approve(email: string) {
    setBusyEmail(email);
    setNotice(null);
    try {
      const response = await fetch("/api/admin/waitlist/approve", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": `waitlist_${crypto.randomUUID().replaceAll("-", "")}`,
          "x-org-id": orgId,
        },
        body: JSON.stringify({ email }),
      });
      const result = await response.json() as { error?: string; emailDelivery?: { sent: boolean; error?: string } };
      if (!response.ok) throw new Error(result.error || "The waitlist user could not be approved");
      setNotice(result.emailDelivery?.sent
        ? { kind: "success", text: `Access approved and the welcome email was sent to ${email}.` }
        : { kind: "error", text: `Access was approved for ${email}, but the email was not sent: ${result.emailDelivery?.error || "delivery unavailable"}.` });
      router.refresh();
    } catch (error) {
      setNotice({ kind: "error", text: error instanceof Error ? error.message : "The approval could not be completed" });
    } finally {
      setBusyEmail(null);
    }
  }

  return <>
    {notice && <p className={`toast ${notice.kind}`} role={notice.kind === "error" ? "alert" : "status"}>{notice.text}</p>}
    <section className="card table-wrap">
      <table>
        <caption className="sr-only">CloseSpan private beta waitlist</caption>
        <thead><tr><th>User</th><th>Status</th><th>Login attempts</th><th>First requested</th><th>Last activity</th><th>Action</th></tr></thead>
        <tbody>
          {entries.length === 0 ? <tr><td className="empty" colSpan={6}>No waitlist users yet.</td></tr> : entries.map((entry) => (
            <tr key={entry.email}>
              <td><strong>{entry.displayName || "Name unavailable"}</strong><small>{entry.email}</small></td>
              <td><span className={statusClass(entry.status)}>{entry.status}</span></td>
              <td>{entry.loginAttemptCount}</td>
              <td>{dateFormatter.format(new Date(entry.firstAttemptedAt))}</td>
              <td>{dateFormatter.format(new Date(entry.lastAttemptedAt))}</td>
              <td>
                {entry.status === "Declined" ? <span className="subtle">Unavailable</span> : (
                  <button className={entry.status === "Approved" ? "btn" : "btn primary"} type="button" disabled={busyEmail !== null} onClick={() => approve(entry.email)}>
                    {busyEmail === entry.email ? <RefreshCw size={14} aria-hidden="true" /> : entry.status === "Approved" ? <Mail size={14} aria-hidden="true" /> : <Check size={14} aria-hidden="true" />}
                    {busyEmail === entry.email ? "Working…" : entry.status === "Approved" ? "Resend email" : "Approve"}
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  </>;
}
