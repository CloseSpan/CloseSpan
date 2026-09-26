import { CloseSpanLogo } from "./closespan-logo";

export type CloseSpan3DLogoSize = "sm" | "md" | "lg";

export function CloseSpan3DLogo({
  className = "",
  decorative = true,
  size = "md",
}: {
  className?: string;
  decorative?: boolean;
  priority?: boolean;
  size?: CloseSpan3DLogoSize;
}) {
  const accessibility = decorative
    ? { "aria-hidden": true as const }
    : { "aria-label": "CloseSpan", role: "img" as const };

  return (
    <span
      className={`closespan-3d-logo closespan-3d-logo--${size} ${className}`.trim()}
      {...accessibility}
    >
      <CloseSpanLogo size={size} />
    </span>
  );
}
