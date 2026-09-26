import { LANDING_BRAND_MARKS, POSTHOG_COLOR_MARK, SLACK_MARK_COLORS } from "@/lib/landing-brand-marks";

export type LandingIntegrationBrand = keyof typeof LANDING_BRAND_MARKS;

export function LandingIntegrationLogo({
  brand,
  className,
}: {
  brand: LandingIntegrationBrand;
  className?: string;
}) {
  const mark = LANDING_BRAND_MARKS[brand];
  const paths = brand === "posthog"
    ? POSTHOG_COLOR_MARK.paths
    : brand === "slack"
      ? (mark.path.match(/M[^M]+/g) ?? []).map((path, index) => ({ path, fill: SLACK_MARK_COLORS[index] }))
      : [{ path: mark.path, fill: mark.fill }];

  return (
    <svg
      className={`brand-icon${className ? ` ${className}` : ""}`}
      data-brand={brand}
      viewBox={brand === "posthog" ? POSTHOG_COLOR_MARK.viewBox : mark.viewBox}
      width={24}
      height={24}
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      {paths.map(({ path, fill }) => <path key={path} d={path} fill={fill} />)}
    </svg>
  );
}
