import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { NotificationDropdownContent, NotificationMenu } from "./notification-menu";

const notification = {
  id: "notification-1", problemId: "problem-1", title: "SSO sessions expire",
  status: "Unread" as const, createdAt: "2026-09-27T15:00:00.000Z",
};

describe("notification dropdown", () => {
  it("uses a collapsed button, not a page link, for the bell", () => {
    const markup = renderToStaticMarkup(<NotificationMenu notifications={[notification]} unreadCount={1} />);
    expect(markup).toContain('type="button"');
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).toContain('aria-label="Open notifications, 1 unread"');
    expect(markup).not.toContain('href="/notifications"');
    expect(markup).not.toContain(notification.title);
  });

  it("keeps View all available in the empty state", () => {
    const markup = renderToStaticMarkup(<NotificationDropdownContent notifications={[]} unreadCount={0} />);
    expect(markup).toContain("No notifications yet");
    expect(markup).toContain('href="/notifications"');
    expect(markup).toContain("View all");
    expect(markup).not.toContain("0 unread");
  });

  it("previews five review requests with dates and the correct destinations", () => {
    const notifications = Array.from({ length: 7 }, (_, index) => ({ ...notification, id: `notification-${index}`, title: `Issue ${index}` }));
    const markup = renderToStaticMarkup(<NotificationDropdownContent notifications={notifications} unreadCount={7} />);
    expect(markup.match(/Review requested/g)).toHaveLength(5);
    expect(markup).toContain("7 unread");
    expect(markup).toContain('href="/pdd/problem-1#engineering-ticket"');
    expect(markup).toContain('dateTime="2026-09-27T15:00:00.000Z"');
    expect(markup).not.toContain("Issue 5");
    expect(markup).toContain('href="/notifications"');
  });

  it("does not give read notifications an unread indicator", () => {
    const markup = renderToStaticMarkup(<NotificationDropdownContent notifications={[{ ...notification, status: "Read" }]} unreadCount={0} />);
    expect(markup).not.toContain('aria-label="Unread"');
  });

  it("caps the visual badge without losing the accessible unread count", () => {
    const markup = renderToStaticMarkup(<NotificationMenu notifications={[]} unreadCount={105} />);
    expect(markup).toContain("99+");
    expect(markup).toContain("Open notifications, 105 unread");
  });
});
