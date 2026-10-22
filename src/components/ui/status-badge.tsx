import type { ComponentProps } from "react";

/** Meaning, not colour: callers say what a status is, the theme decides how it looks. */
export type StatusTone = "neutral" | "success" | "warning" | "danger" | "info";

const TONE_CLASS: Record<StatusTone, string | null> = {
  neutral: null,
  success: "success",
  warning: "warning",
  danger: "critical",
  info: "brand",
};

export function StatusBadge({ tone = "neutral", className, ...props }: ComponentProps<"span"> & { tone?: StatusTone }) {
  return <span className={["badge", TONE_CLASS[tone], className].filter(Boolean).join(" ")} {...props} />;
}

/** Issue severity keeps its own scale (critical, high, medium, low). */
export function SeverityBadge({ severity, className, children, ...props }: ComponentProps<"span"> & { severity: string }) {
  return <span className={["badge", severity.toLowerCase(), className].filter(Boolean).join(" ")} {...props}>{children ?? severity}</span>;
}
