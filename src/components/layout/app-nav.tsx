"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarRange, Images, Link2, Settings, Sparkles } from "lucide-react";
import { clsx } from "clsx";

import { type NavAccent, NAV_ITEMS } from "@/config/navigation";

const ICONS = {
  Planner: CalendarRange,
  Create: Sparkles,
  Library: Images,
  Connections: Link2,
  Settings: Settings,
} as const;

const ACCENT_STYLES: Record<NavAccent, {
  buttonActive: string;
  buttonInactive: string;
  badgeActive: string;
  badgeInactive: string;
}> = {
  teal: {
    buttonActive: "bg-brand-teal text-white",
    buttonInactive: "bg-brand-teal/15 text-brand-teal hover:bg-brand-teal/25",
    badgeActive: "bg-white/20 text-white",
    badgeInactive: "bg-brand-teal/25 text-brand-teal",
  },
  caramel: {
    buttonActive: "bg-brand-caramel text-white",
    buttonInactive: "bg-brand-caramel/15 text-brand-caramel hover:bg-brand-caramel/25",
    badgeActive: "bg-white/20 text-white",
    badgeInactive: "bg-brand-caramel/20 text-brand-caramel",
  },
  oat: {
    buttonActive: "bg-brand-oat text-white",
    buttonInactive: "bg-brand-oat/20 text-brand-oat hover:bg-brand-oat/30",
    badgeActive: "bg-white/20 text-white",
    badgeInactive: "bg-brand-oat/25 text-brand-oat",
  },
  sandstone: {
    buttonActive: "bg-brand-sandstone text-white",
    buttonInactive: "bg-brand-sandstone/20 text-brand-sandstone hover:bg-brand-sandstone/30",
    badgeActive: "bg-white/20 text-white",
    badgeInactive: "bg-brand-sandstone/25 text-brand-sandstone",
  },
  mist: {
    buttonActive: "bg-brand-mist text-white",
    buttonInactive: "bg-brand-mist/25 text-brand-mist hover:bg-brand-mist/35",
    badgeActive: "bg-white/20 text-white",
    badgeInactive: "bg-brand-mist/30 text-brand-mist",
  },
};

export function AppNav() {
  const pathname = usePathname();

  return (
    <nav className="flex flex-wrap items-center gap-2 rounded-2xl border border-brand-teal/20 bg-white/95 px-3 py-2 shadow-sm">
      {NAV_ITEMS.map((item) => {
        const Icon = ICONS[item.label as keyof typeof ICONS] ?? CalendarRange;
        const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
        const accent = ACCENT_STYLES[item.accent];

        return (
          <Link
            key={item.href}
            href={item.href}
            className={clsx(
              "group inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-teal/40",
              isActive ? accent.buttonActive : accent.buttonInactive,
            )}
          >
            <Icon className="h-4 w-4" />
            <span>{item.label}</span>
            <span
              className={clsx(
                "hidden rounded-full px-2 py-0.5 text-[11px] font-medium md:inline-flex",
                isActive ? accent.badgeActive : accent.badgeInactive,
              )}
            >
              {item.description}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
