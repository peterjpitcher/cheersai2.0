"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarRange, Images, Link2, Settings, Sparkles } from "lucide-react";
import { clsx } from "clsx";

import { NAV_ITEMS } from "@/config/navigation";

const ICONS = {
  Planner: CalendarRange,
  Create: Sparkles,
  Library: Images,
  Connections: Link2,
  Settings: Settings,
} as const;

export function AppNav() {
  const pathname = usePathname();

  return (
    <nav className="flex flex-wrap items-center gap-2 rounded-2xl border border-brand-ambergold/20 bg-white/60 px-3 py-2 shadow-sm">
      {NAV_ITEMS.map((item) => {
        const Icon = ICONS[item.label as keyof typeof ICONS] ?? CalendarRange;
        const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);

        return (
          <Link
            key={item.href}
            href={item.href}
            className={clsx(
              "group inline-flex items-center gap-2 rounded-full bg-brand-ambergold px-4 py-2 text-sm font-semibold uppercase tracking-wide text-white transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ambergold/30",
              isActive
                ? "shadow-lg ring-2 ring-brand-ambergold/40"
                : "shadow-sm opacity-80 hover:opacity-100",
            )}
          >
            <Icon className="h-4 w-4" />
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
