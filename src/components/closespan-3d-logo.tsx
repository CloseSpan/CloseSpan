import Image from "next/image";

export type CloseSpan3DLogoSize = "sm" | "md" | "lg";

export function CloseSpan3DLogo({
  className = "",
  decorative = true,
  priority = false,
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
      <Image
        alt=""
        className="closespan-3d-logo__image closespan-3d-logo__image--light"
        height={725}
        priority={priority}
        sizes="(max-width: 720px) 168px, 220px"
        src="/closespan-3d-logo-light-transparent-v2.png"
        width={2169}
      />
      <Image
        alt=""
        className="closespan-3d-logo__image closespan-3d-logo__image--dark"
        height={725}
        priority={priority}
        sizes="(max-width: 720px) 168px, 220px"
        src="/closespan-3d-logo-dark-transparent-v2.png"
        width={2168}
      />
      <span className="closespan-3d-logo__forced-colors">CloseSpan</span>
    </span>
  );
}
