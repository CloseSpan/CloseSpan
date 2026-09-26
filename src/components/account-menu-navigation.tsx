"use client";

import { Blocks, ListChecks, Palette, Settings, UsersRound } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const accountNavigation = [
  {
    href: "/integrations",
    label: "Integrations",
    icon: Blocks,
    adminOnly: false,
    moderatorOnly: false,
  },
  {
    href: "/settings",
    label: "Settings",
    icon: Settings,
    adminOnly: false,
    moderatorOnly: false,
  },
  {
    href: "/settings/appearance",
    label: "Appearance",
    icon: Palette,
    adminOnly: false,
    moderatorOnly: false,
  },
  {
    href: "/admin/users",
    label: "Active users",
    icon: UsersRound,
    adminOnly: true,
    moderatorOnly: false,
  },
  {
    href: "/admin/requests",
    label: "Review feature requests",
    icon: ListChecks,
    adminOnly: false,
    moderatorOnly: true,
  },
] as const;

export function AccountMenuNavigation({
  showPlatformAdmin,
  showFeatureRequestModeration = false,
}: {
  showPlatformAdmin: boolean;
  showFeatureRequestModeration?: boolean;
}) {
  const pathname = usePathname();

  return (
    <nav className="user-menu-navigation" aria-label="Account and administration">
      {accountNavigation.map(({ href, label, icon: Icon, adminOnly, moderatorOnly }) => {
        if ((adminOnly && !showPlatformAdmin) || (moderatorOnly && !showFeatureRequestModeration)) {
          return null;
        }

        const matchesPath = pathname === href || pathname.startsWith(`${href}/`);
        const hasMoreSpecificMatch = accountNavigation.some(
          (item) => item.href.startsWith(`${href}/`) &&
            (pathname === item.href || pathname.startsWith(`${item.href}/`)),
        );
        const active = matchesPath && !hasMoreSpecificMatch;
        return (
          <Link
            href={href}
            className={active ? "active" : undefined}
            aria-current={active ? "page" : undefined}
            key={href}
          >
            <Icon aria-hidden="true" size={16} />
            <span>{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
