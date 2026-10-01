"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Ban, ShieldCheck, Trash2 } from "lucide-react";
import type { PlatformUserAction } from "@/lib/platform-user-management";

export function PlatformUserActions({ email, displayName, status, orgId, deleteRestriction, onComplete }: {
  email: string;
  displayName: string;
  status: "Active" | "Blocked";
  orgId: string;
  deleteRestriction?: string;
  onComplete: (message: string) => void;
}) {
  const [action, setAction] = useState<PlatformUserAction | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [completed, setCompleted] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const pending = useRef(false);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const requestId = useRef("");
  const titleId = useId();
  const descriptionId = useId();
  const isDelete = action === "delete";
  const label = action === "unblock" ? "Unblock user" : isDelete ? "Delete user" : "Block user";

  useEffect(() => {
    if (action) dialog.current?.showModal();
    else if (dialog.current?.open) {
      dialog.current.close();
      trigger.current?.focus();
    }
  }, [action]);

  function open(next: PlatformUserAction, button: HTMLButtonElement) {
    trigger.current = button;
    requestId.current = crypto.randomUUID();
    setConfirmation(""); setError(null); setAction(next);
  }

  async function submit() {
    if (!action || pending.current || (isDelete && (deleteRestriction || confirmation.trim().toLowerCase() !== email))) return;
    pending.current = true; setBusy(true); setError(null);
    try {
      const response = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-org-id": orgId, "idempotency-key": requestId.current },
        body: JSON.stringify({ email, action, expectedStatus: status, ...(isDelete ? { confirmationEmail: confirmation } : {}) }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof result.error === "string" ? result.error : "The action failed. Try again.");
      setCompleted(true); setAction(null);
      onComplete(`${displayName} ${action === "delete" ? "was deleted" : action === "block" ? "is now blocked" : "can access CloseSpan again"}.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The action failed. Try again.");
    } finally {
      pending.current = false; setBusy(false);
    }
  }

  return <>
    <div className="platform-user-actions">
      <button type="button" className="btn" disabled={completed} aria-label={`${status === "Blocked" ? "Unblock" : "Block"} ${displayName}`} onClick={(event) => open(status === "Blocked" ? "unblock" : "block", event.currentTarget)}>
        {status === "Blocked" ? <ShieldCheck size={15} aria-hidden="true" /> : <Ban size={15} aria-hidden="true" />}
        {status === "Blocked" ? "Unblock" : "Block"}
      </button>
      <button type="button" className="btn danger" disabled={completed} aria-label={`Delete ${displayName}`} onClick={(event) => open("delete", event.currentTarget)}><Trash2 size={15} aria-hidden="true" />Delete</button>
    </div>
    <dialog ref={dialog} className="platform-user-dialog" aria-labelledby={titleId} aria-describedby={descriptionId} onCancel={(event) => { event.preventDefault(); if (!pending.current) setAction(null); }}>
      <form onSubmit={(event) => { event.preventDefault(); void submit(); }}>
        <h2 id={titleId}>{label}?</h2>
        <p className="platform-user-identity"><strong>{displayName}</strong><span>{email}</span></p>
        <p id={descriptionId}>{isDelete
          ? "Permanently remove this user's workspace memberships and sign-in history. Workspaces, customer data, and historical audit records are preserved. A minimal access record is kept to prevent this account from being recreated. This cannot be undone."
          : action === "unblock"
            ? "Restore this user's access to their existing workspaces. Their roles and data will stay the same."
            : "Prevent this user from signing in or accessing any workspace, including through an existing session. Their data and memberships stay intact. You can unblock them later."}</p>
        {isDelete && deleteRestriction && <p className="platform-user-error">{deleteRestriction}</p>}
        {isDelete && !deleteRestriction && <label className="field"><span>Type <strong>{email}</strong> to confirm</span><input type="email" autoComplete="off" spellCheck={false} maxLength={320} value={confirmation} disabled={busy} onChange={(event) => setConfirmation(event.target.value)} /></label>}
        {error && <p role="alert" className="platform-user-error">{error}</p>}
        <div className="platform-user-dialog-actions">
          <button className="btn" type="button" autoFocus disabled={busy} onClick={() => setAction(null)}>Cancel</button>
          <button className={`btn ${action === "unblock" ? "" : "danger"}`} type="submit" disabled={busy || (isDelete && (!!deleteRestriction || confirmation.trim().toLowerCase() !== email))}>{busy ? "Saving…" : label}</button>
        </div>
      </form>
    </dialog>
  </>;
}
