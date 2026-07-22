export type ClosespanLogoVariant = "lockup" | "mark";
export type ClosespanLogoTone = "default" | "inverse";
export type ClosespanLogoSize = "xs" | "sm" | "md" | "lg";

export function ClosespanLogo({
  variant = "lockup",
  tone = "default",
  size = "md",
  className = "",
  decorative = true,
}: {
  variant?: ClosespanLogoVariant;
  tone?: ClosespanLogoTone;
  size?: ClosespanLogoSize;
  className?: string;
  decorative?: boolean;
}) {
  const classes = [
    "closespan-logo",
    `closespan-logo--${variant}`,
    `closespan-logo--${tone}`,
    `closespan-logo--${size}`,
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <span
      className={classes}
      aria-hidden={decorative ? true : undefined}
      aria-label={decorative ? undefined : "Closespan"}
      role={decorative ? undefined : "img"}
    >
      <span className="closespan-logo__syntax">{"</"}</span>
      {variant === "lockup" && (
        <span className="closespan-logo__name">
          <span className="closespan-logo__close">Close</span>
          <span className="closespan-logo__span">Span</span>
        </span>
      )}
      <span className="closespan-logo__syntax">{">"}</span>
    </span>
  );
}
