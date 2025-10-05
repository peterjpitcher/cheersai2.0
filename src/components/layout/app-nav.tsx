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
  cardActive: string;
  cardInactive: string;
  iconActive: string;
  iconInactive: string;
  titleActive: string;
  titleInactive: string;
  mutedActive: string;
  mutedInactive: string;
  focusRing: string;
}> = {
  teal: {
    cardActive: "border-brand-teal bg-brand-teal text-white shadow-xl",
    cardInactive: "border-brand-teal/50 bg-brand-teal/80 text-white/90 hover:bg-brand-teal hover:text-white",
    iconActive: "border-white/25 bg-white/20 text-white",
    iconInactive: "border-white/25 bg-white/10 text-white/90",
    titleActive: "text-white",
    titleInactive: "text-white",
    mutedActive: "text-white/80",
    mutedInactive: "text-white/75",
    focusRing: "focus-visible:ring-white/70",
  },
  caramel: {
    cardActive: "border-brand-caramel bg-brand-caramel text-white shadow-xl",
    cardInactive: "border-brand-caramel/60 bg-brand-caramel/85 text-white/90 hover:bg-brand-caramel hover:text-white",
    iconActive: "border-white/25 bg-white/20 text-white",
    iconInactive: "border-white/25 bg-white/10 text-white/85",
    titleActive: "text-white",
    titleInactive: "text-white",
    mutedActive: "text-white/80",
    mutedInactive: "text-white/75",
    focusRing: "focus-visible:ring-white/70",
  },
  oat: {
    cardActive: "border-brand-oat bg-brand-oat text-brand-sandstone shadow-xl",
    cardInactive:
      "border-brand-oat/60 bg-brand-oat/90 text-brand-sandstone/90 hover:bg-brand-oat hover:text-brand-sandstone",
    iconActive: "border-brand-sandstone/20 bg-white/70 text-brand-sandstone",
    iconInactive: "border-brand-sandstone/20 bg-white/60 text-brand-sandstone",
    titleActive: "text-brand-sandstone",
    titleInactive: "text-brand-sandstone",
    mutedActive: "text-brand-sandstone/70",
    mutedInactive: "text-brand-sandstone/60",
    focusRing: "focus-visible:ring-brand-sandstone/40",
  },
  sandstone: {
    cardActive: "border-brand-sandstone bg-brand-sandstone text-white shadow-xl",
    cardInactive:
      "border-brand-sandstone/50 bg-brand-sandstone/85 text-white/90 hover:bg-brand-sandstone hover:text-white",
    iconActive: "border-white/25 bg-white/20 text-white",
    iconInactive: "border-white/25 bg-white/10 text-white/85",
    titleActive: "text-white",
    titleInactive: "text-white",
    mutedActive: "text-white/80",
    mutedInactive: "text-white/70",
    focusRing: "focus-visible:ring-white/70",
  },
  mist: {
    cardActive: "border-brand-mist bg-brand-mist text-brand-teal shadow-xl",
    cardInactive:
      "border-brand-mist/70 bg-brand-mist/90 text-brand-teal/85 hover:bg-brand-mist hover:text-brand-teal",
    iconActive: "border-brand-teal/20 bg-white text-brand-teal",
    iconInactive: "border-brand-teal/20 bg-white/90 text-brand-teal/80",
    titleActive: "text-brand-teal",
    titleInactive: "text-brand-teal",
    mutedActive: "text-brand-teal/70",
    mutedInactive: "text-brand-teal/60",
    focusRing: "focus-visible:ring-brand-teal/50",
  },
};

export function AppNav() {
  const pathname = usePathname();

  return (
    <nav className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {NAV_ITEMS.map((item) => {
        const Icon = ICONS[item.label as keyof typeof ICONS] ?? CalendarRange;
        const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
        const accent = ACCENT_STYLES[item.accent];

        return (
          <Link
            key={item.href}
            href={item.href}
            className={clsx(
              "group flex min-h-[120px] items-start gap-4 rounded-3xl border-2 px-5 py-4 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2",
              accent.focusRing,
              isActive ? accent.cardActive : accent.cardInactive,
            )}
          >
            <span
              className={clsx(
                "flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border text-sm transition-all",
                isActive ? accent.iconActive : accent.iconInactive,
              )}
            >
              <Icon className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <p className={clsx("text-base font-semibold", isActive ? accent.titleActive : accent.titleInactive)}>
                {item.label}
              </p>
              <p className={clsx("mt-1 text-sm leading-snug", isActive ? accent.mutedActive : accent.mutedInactive)}>
                {item.description}
              </p>
            </div>
          </Link>
        );
      })}
    </nav>
  );
}
