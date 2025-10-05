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
    <nav className="flex min-w-max flex-nowrap gap-3 text-white/85 lg:min-w-full lg:flex-wrap">
      {NAV_ITEMS.map((item) => {
        const Icon = ICONS[item.label as keyof typeof ICONS] ?? CalendarRange;
        const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);

        return (
          <Link
            key={item.href}
            href={item.href}
            className={clsx(
              "group flex w-[260px] shrink-0 items-center gap-4 rounded-2xl border px-4 py-3 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80 lg:w-auto lg:flex-1",
              isActive
                ? "border-white bg-white text-brand-teal shadow-lg hover:bg-white"
                : "border-white/20 bg-white/10 text-white/90 hover:border-white/35 hover:bg-white/15"
            )}
          >
            <span
              className={clsx(
                "flex h-10 w-10 items-center justify-center rounded-full border text-sm transition-all",
                isActive
                  ? "border-brand-teal/10 bg-brand-teal text-white shadow-lg"
                  : "border-white/30 bg-white/10 text-white"
              )}
            >
              <Icon className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <p className={clsx("text-sm font-semibold", isActive ? "text-brand-teal" : "text-white")}>{item.label}</p>
              <p
                className={clsx(
                  "text-xs leading-snug",
                  isActive ? "text-brand-teal/80" : "text-white/70"
                )}
              >
                {item.description}
              </p>
            </div>
          </Link>
        );
      })}
    </nav>
  );
}
