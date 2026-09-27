"use client";

import { Bell, ChevronRight } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import type { PromptReviewNotificationView } from "@/lib/prompt-review-notification-repository";
import styles from "./notification-menu.module.css";

type NotificationPreview = Pick<PromptReviewNotificationView, "id" | "problemId" | "title" | "status" | "createdAt">;
type NotificationMenuProps = {
  notifications: NotificationPreview[];
  unreadCount: number;
};

export function NotificationDropdownContent({
  notifications,
  unreadCount,
  onNavigate,
}: NotificationMenuProps & { onNavigate?: () => void }) {
  return (
    <>
      <div className={styles.header}>
        <strong>Notifications</strong>
        {unreadCount > 0 && <span>{unreadCount} unread</span>}
      </div>
      {notifications.length ? (
        <ul className={styles.list}>
          {notifications.slice(0, 5).map((notification) => (
            <li key={notification.id}>
              <Link
                href={`/pdd/${notification.problemId}#engineering-ticket`}
                prefetch={false}
                className={styles.item}
                onClick={onNavigate}
              >
                <span className={styles.itemHeading}>
                  <span>Review requested</span>
                  {notification.status === "Unread" && <span className={styles.unread} aria-label="Unread" />}
                </span>
                <strong>{notification.title}</strong>
                <time dateTime={notification.createdAt}>
                  {new Date(notification.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}
                </time>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <div className={styles.empty}>
          <Bell size={22} aria-hidden="true" />
          <strong>No notifications yet</strong>
          <p>New review requests will appear here.</p>
        </div>
      )}
      <Link href="/notifications" prefetch={false} className={styles.viewAll} onClick={onNavigate}>
        View all <ChevronRight size={15} aria-hidden="true" />
      </Link>
    </>
  );
}

export function NotificationMenu(props: NotificationMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    function dismissOutside(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function dismissOnEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
    }
    document.addEventListener("pointerdown", dismissOutside);
    document.addEventListener("keydown", dismissOnEscape);
    return () => {
      document.removeEventListener("pointerdown", dismissOutside);
      document.removeEventListener("keydown", dismissOnEscape);
    };
  }, [open]);

  return (
    <div className={styles.root} ref={rootRef} onBlur={(event) => {
      if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) setOpen(false);
    }}>
      <button
        ref={triggerRef}
        type="button"
        className="btn icon-btn notification-button"
        aria-label={`Open notifications${props.unreadCount ? `, ${props.unreadCount} unread` : ""}`}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((current) => !current)}
      >
        <Bell size={15} aria-hidden="true" />
        {props.unreadCount > 0 && <span className="notification-count" aria-hidden="true">{props.unreadCount > 99 ? "99+" : props.unreadCount}</span>}
      </button>
      {open && (
        <section id={panelId} className={styles.panel} aria-label="Notifications">
          <NotificationDropdownContent {...props} onNavigate={() => setOpen(false)} />
        </section>
      )}
    </div>
  );
}
