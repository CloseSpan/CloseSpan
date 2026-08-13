"use client";

import Link from "next/link";
import { Check, Mail } from "lucide-react";
import { useState } from "react";
import type { PromptReviewNotificationView } from "@/lib/prompt-review-notification-repository";

export function PromptReviewNotifications({
  orgId,
  initialNotifications,
}: {
  orgId: string;
  initialNotifications: PromptReviewNotificationView[];
}) {
  const [notifications, setNotifications] = useState(initialNotifications);
  const [busyId, setBusyId] = useState<string>();
  const [error, setError] = useState<string | null>(null);

  async function markRead(id: string): Promise<void> {
    setBusyId(id);
    setError(null);
    try {
      const response = await fetch(`/api/notifications/${id}/read`, {
        method: "POST",
        headers: {
          "x-org-id": orgId,
          "idempotency-key": crypto.randomUUID(),
          "x-request-id": crypto.randomUUID(),
        },
      });
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      if (!response.ok) {
        throw new Error(
          payload.error ?? "This notification could not be marked as read.",
        );
      }
      setNotifications((current) =>
        current.map((item) =>
          item.id === id
            ? { ...item, status: "Read", readAt: new Date().toISOString() }
            : item,
        ),
      );
    } catch (markReadError) {
      setError(
        markReadError instanceof Error
          ? markReadError.message
          : "This notification could not be marked as read.",
      );
    } finally {
      setBusyId(undefined);
    }
  }

  if (!notifications.length)
    return <div className="empty"><Mail size={30} /><h3>No prompt reviews yet</h3><p>Assigned implementation-prompt drafts will appear here.</p></div>;

  return (
    <div className="detail-stack">
      {error && (
        <p className="toast error" role="alert">
          {error}
        </p>
      )}
      {notifications.map((notification) => (
        <article className={`card notification-card ${notification.status === "Unread" ? "notification-unread" : ""}`} key={notification.id}>
          <div className="card-body split">
            <div>
              <span className={`badge ${notification.status === "Unread" ? "brand" : ""}`}>{notification.status}</span>
              <h3 className="section-gap-xs">Review implementation prompt</h3>
              <p>{notification.title}</p>
              <p className="subtle">{notification.artifactPath}</p>
              <small className="subtle">{new Date(notification.createdAt).toLocaleString()}</small>
            </div>
            <div className="top-actions">
              <Link className="btn primary" href={`/pdd/${notification.problemId}#engineering-ticket`}>Review</Link>
              {notification.status === "Unread" && (
                <button className="btn" type="button" disabled={busyId === notification.id} onClick={() => void markRead(notification.id)}>
                  <Check size={14} /> {busyId === notification.id ? "Saving…" : "Mark read"}
                </button>
              )}
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}
