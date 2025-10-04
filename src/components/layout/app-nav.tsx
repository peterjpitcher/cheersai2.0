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
    <nav className="flex flex-col gap-2">
      {NAV_ITEMS.map((item) => {
        const Icon = ICONS[item.label as keyof typeof ICONS] ?? CalendarRange;
        const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);

        return (
          <Link
            key={item.href}
            href={item.href}
            className={clsx(
              "flex items-start gap-3 rounded-xl border p-4 transition hover:border-slate-300 hover:bg-slate-50",
              isActive
                ? "border-slate-900 bg-slate-900 text-white hover:bg-slate-900"
                : "border-slate-200"
            )}
          >
            <Icon className={clsx("mt-0.5 h-5 w-5", isActive ? "text-white" : "text-slate-600")} />
            <div>
              <p className="text-sm font-semibold">{item.label}</p>
              <p className="text-sm text-slate-500">{item.description}</p>
            </div>
          </Link>
        );
      })}
    </nav>
  );
}
