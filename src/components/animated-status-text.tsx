import { ChevronRight } from "lucide-react";

export function AnimatedStatusText({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <span className="animated-status-text" role="status" aria-live="polite">
      <span className="animated-status-text-label">{children}</span>
      <ChevronRight
        className="animated-status-text-chevron"
        size={16}
        strokeWidth={2.25}
        aria-hidden="true"
      />
    </span>
  );
}
