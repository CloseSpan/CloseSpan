"use client";

import { AlertTriangle, LoaderCircle, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useRef, useState } from "react";

interface AgentRunDeleteButtonProps {
  runId: string;
  runLabel: string;
  status: string;
  canDelete: boolean;
}

export function AgentRunDeleteButton({
  runId,
  runLabel,
  status,
  canDelete,
}: AgentRunDeleteButtonProps) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const active = status === "Queued" || status === "Running";

  function openDialog(): void {
    setError(null);
    dialogRef.current?.showModal();
    window.requestAnimationFrame(() => cancelRef.current?.focus());
  }

  function closeDialog(): void {
    if (busy) return;
    dialogRef.current?.close();
  }

  async function deleteRun(): Promise<void> {
    if (busy || active || !canDelete) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/agent-runs/${encodeURIComponent(runId)}`, {
        method: "DELETE",
        headers: {
          "idempotency-key": `delete_run_${crypto.randomUUID().replaceAll("-", "")}`,
        },
      });
      const payload = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;
      if (!response.ok) {
        throw new Error(payload?.error ?? "The run could not be deleted.");
      }
      dialogRef.current?.close();
      router.refresh();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "The run could not be deleted.",
      );
    } finally {
      setBusy(false);
    }
  }

  const triggerLabel = canDelete
    ? `Delete run for ${runLabel}`
    : "Only workspace administrators can delete runs";

  return (
    <>
      <button
        className="agent-run-delete-trigger"
        type="button"
        aria-label={triggerLabel}
        title={triggerLabel}
        disabled={!canDelete}
        onClick={openDialog}
      >
        <Trash2 size={17} aria-hidden="true" />
      </button>
      <dialog
        className="organization-create-dialog organization-rename-dialog agent-run-delete-dialog"
        ref={dialogRef}
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        onCancel={(event) => {
          if (busy) event.preventDefault();
        }}
        onClick={(event) => {
          if (event.target === event.currentTarget) closeDialog();
        }}
      >
        <div className="organization-create-panel agent-run-delete-panel">
          <header className="organization-create-head">
            <div>
              <span className="eyebrow">Permanent action</span>
              <h2 id={titleId}>Delete this agent run?</h2>
              <p className="subtle" id={descriptionId}>
                This removes the run record and its linked verification and
                release activity. The product problem and original approval
                history stay available.
              </p>
            </div>
            <button
              className="icon-button"
              type="button"
              aria-label="Close delete confirmation"
              disabled={busy}
              onClick={closeDialog}
            >
              <X size={19} aria-hidden="true" />
            </button>
          </header>
          <div className="agent-run-delete-body">
            <div className="agent-run-delete-warning" role="note">
              <AlertTriangle size={19} aria-hidden="true" />
              <div>
                <strong>
                  {active ? "Cancel this run first" : "This cannot be undone"}
                </strong>
                <p>
                  {active
                    ? "Queued and running work must be cancelled from the run page before its record can be deleted."
                    : `The run for “${runLabel}” will be permanently removed.`}
                </p>
              </div>
            </div>
            {error ? (
              <p className="form-error" role="alert">
                {error}
              </p>
            ) : null}
            <div className="organization-create-actions agent-run-delete-actions">
              <button
                className="btn"
                type="button"
                ref={cancelRef}
                disabled={busy}
                onClick={closeDialog}
              >
                Cancel
              </button>
              <button
                className="btn organization-delete-submit"
                type="button"
                disabled={busy || active}
                onClick={() => void deleteRun()}
              >
                {busy ? (
                  <LoaderCircle className="spin" size={16} aria-hidden="true" />
                ) : (
                  <Trash2 size={16} aria-hidden="true" />
                )}
                {busy ? "Deleting…" : "Delete run"}
              </button>
            </div>
          </div>
        </div>
      </dialog>
    </>
  );
}
