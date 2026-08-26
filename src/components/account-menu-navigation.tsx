"use client";

import { Blocks, Settings, UsersRound } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const accountNavigation = [
  {
    href: "/integrations",
    label: "Integrations",
    icon: Blocks,
    adminOnly: false,
  },
  {
    href: "/settings",
    label: "Settings",
    icon: Settings,
    adminOnly: false,
  },
  {
    href: "/admin/users",
    label: "Active users",
    icon: UsersRound,
    adminOnly: true,
  },
] as const;

export function AccountMenuNavigation({
  showPlatformAdmin,
}: {
  showPlatformAdmin: boolean;
}) {
  const pathname = usePathname();

  return (
    <nav className="user-menu-navigation" aria-label="Account and administration">
      {accountNavigation.map(({ href, label, icon: Icon, adminOnly }) => {
        if (adminOnly && !showPlatformAdmin) {
          return null;
        }

        const active = pathname === href || pathname.startsWith(`${href}/`);
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
