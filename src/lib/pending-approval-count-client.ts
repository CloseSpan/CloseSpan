export const PENDING_APPROVAL_COUNT_EVENT = "closespan:pending-approval-count-change";

export interface PendingApprovalCountChange {
  delta: number;
}

export function announcePendingApprovalCountChange(delta: number): void {
  if (typeof window === "undefined" || delta === 0) return;
  window.dispatchEvent(new CustomEvent<PendingApprovalCountChange>(
    PENDING_APPROVAL_COUNT_EVENT,
    { detail: { delta } },
  ));
}
