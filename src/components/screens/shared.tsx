"use client";

import { EmptyState, PageHeader } from "@/components/ui";

export const money = (value: number) =>
  Math.round(value) < 1000
    ? `$${Math.max(0, Math.round(value)).toLocaleString("en-US")}`
    : `$${Math.round(value / 1000)}k`;

export const compactMoney = (value: number) =>
  value >= 1_000_000
    ? `$${(value / 1_000_000).toFixed(2).replace(/0+$/, "").replace(/\.$/, "")}m`
    : money(value);

/** Inline " · $Xk ARR" fragment; omitted when there is no revenue data. */
export const arrFragment = (value: number) => (value > 0 ? ` · ${compactMoney(value)} ARR` : "");

export const MODAL_FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

export function getModalFocusableElements(container: HTMLElement) {
  return Array.from(
    container.querySelectorAll<HTMLElement>(MODAL_FOCUSABLE_SELECTOR),
  ).filter(
    (element) =>
      element.getAttribute("aria-hidden") !== "true" &&
      !element.closest("[aria-hidden='true']") &&
      (element.offsetWidth > 0 ||
        element.offsetHeight > 0 ||
        element.getClientRects().length > 0),
  );
}

export function containModalFocus(
  event: KeyboardEvent,
  container: HTMLElement,
  onClose: () => void,
) {
  if (event.key === "Escape") {
    event.preventDefault();
    onClose();
    return;
  }
  if (event.key !== "Tab") return;

  const focusableElements = getModalFocusableElements(container);
  if (!focusableElements.length) {
    event.preventDefault();
    container.focus({ preventScroll: true });
    return;
  }

  const firstElement = focusableElements[0];
  const lastElement = focusableElements[focusableElements.length - 1];
  const activeElement = document.activeElement;
  const activeElementIsFocusable =
    activeElement instanceof HTMLElement &&
    focusableElements.includes(activeElement);
  if (
    event.shiftKey &&
    (activeElement === firstElement || !activeElementIsFocusable)
  ) {
    event.preventDefault();
    lastElement.focus();
  } else if (
    !event.shiftKey &&
    (activeElement === lastElement || !activeElementIsFocusable)
  ) {
    event.preventDefault();
    firstElement.focus();
  }
}

/** Kept for existing callers; new screens use PageHeader from "@/components/ui". */
export const PageTitle = PageHeader;

export function EmptyWorkspaceState({
  title,
  description,
  actionHref,
  actionLabel,
}: {
  title: string;
  description: string;
  actionHref: string;
  actionLabel: string;
}) {
  return <EmptyState title={title} description={description} action={{ href: actionHref, label: actionLabel }} />;
}

export function investigationStatusLabel(status: string) {
  return status === "Ready for approval" ? "Ready for review" : status;
}

export function investigationStatusTone(status: string) {
  const label = investigationStatusLabel(status).toLowerCase();
  if (label.includes("ready")) return "success";
  if (label.includes("gather") || label.includes("context")) return "medium";
  return "";
}
