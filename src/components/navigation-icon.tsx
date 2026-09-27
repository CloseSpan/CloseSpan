import { CircleCheck, CircleDot, FlaskConical, Gauge, Grid2X2Plus, Inbox, Palette, Settings, ShieldCheck, Bot, type LucideIcon } from "lucide-react";

/** Keep Lucide outlines at rest; add readable cutouts over the active silhouette. */
export function NavigationIcon({ icon: Icon, active = false, size = 18 }: {
  icon: LucideIcon;
  active?: boolean;
  size?: number;
}) {
  return (
    <Icon aria-hidden="true" size={size} className="navigation-icon" data-icon-variant={active ? "filled" : "outline"}>
      {active && <>
        {Icon === CircleDot && <circle className="navigation-icon-cutout" cx="12" cy="12" r="1" />}
        {Icon === Settings && <circle className="navigation-icon-cutout" cx="12" cy="12" r="3" />}
        {(Icon === CircleCheck || Icon === ShieldCheck) && <path className="navigation-icon-detail" d="m9 12 2 2 4-4" />}
        {Icon === Bot && <path className="navigation-icon-detail" d="M9 13v2m6-2v2" />}
        {Icon === Inbox && <path className="navigation-icon-detail" d="M3 12h5l2 3h4l2-3h5" />}
        {Icon === FlaskConical && <path className="navigation-icon-detail" d="M7 15h10" />}
        {Icon === Gauge && <path className="navigation-icon-detail" d="m12 14 4-4" />}
        {Icon === Palette && <g className="navigation-icon-cutout">
          <circle cx="13.5" cy="6.5" r=".5" />
          <circle cx="17.5" cy="10.5" r=".5" />
          <circle cx="8.5" cy="7.5" r=".5" />
          <circle cx="6.5" cy="12.5" r=".5" />
        </g>}
        {Icon === Grid2X2Plus && <g>
          <rect x="3" y="3" width="7" height="7" rx="1" />
          <rect x="14" y="3" width="7" height="7" rx="1" />
          <rect x="3" y="14" width="7" height="7" rx="1" />
        </g>}
      </>}
    </Icon>
  );
}
