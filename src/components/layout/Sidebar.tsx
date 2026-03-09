"use client";

import { motion } from "framer-motion";
import {
  CalendarDays,
  Megaphone,
  Settings,
  LogOut,
  ChevronLeft,
  ChevronRight,
  PlusCircle,
  Image,
  Share2,
  Star,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { useFormStatus } from "react-dom";

import { signOut } from "@/lib/auth/actions";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { label: "Planner", href: "/planner", icon: CalendarDays },
  { label: "Create", href: "/create", icon: PlusCircle },
  { label: "Library", href: "/library", icon: Image },
  { label: "Campaigns", href: "/campaigns", icon: Megaphone },
  { label: "Reviews", href: "/reviews", icon: Star },
  { label: "Connections", href: "/connections", icon: Share2 },
  { label: "Settings", href: "/settings", icon: Settings },
];

export function Sidebar() {
  const [collapsed, setCollapsed] = useState(false);
  const pathname = usePathname();

  return (
    <motion.aside
      initial={{ width: 260 }}
      animate={{ width: collapsed ? 80 : 260 }}
      className="sticky top-0 z-30 hidden h-screen flex-col border-r border-border bg-sidebar text-sidebar-foreground md:flex"
    >
      <div className="flex h-16 items-center justify-between border-b border-sidebar-border px-4">
        {collapsed ? (
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary text-white shadow-sm">
            <span className="font-heading text-sm font-bold leading-none">C</span>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary text-white shadow-sm">
              <span className="font-heading text-sm font-bold leading-none">C</span>
            </div>
            <span className="font-heading text-lg font-bold tracking-tight text-sidebar-foreground">
              CheersAI
            </span>
          </div>
        )}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="rounded-md p-1.5 text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent"
        >
          {collapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
        </button>
      </div>

      <nav className="flex-1 space-y-1 px-3 py-6">
        {NAV_ITEMS.map((item) => {
          const isActive = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "group relative flex items-center gap-3 rounded-md px-3 py-2.5 transition-all duration-200",
                isActive
                  ? "bg-sidebar-primary/90 text-sidebar-primary-foreground shadow-sm before:absolute before:left-0 before:top-1/2 before:-translate-y-1/2 before:h-4 before:w-0.5 before:rounded-full before:bg-white/60"
                  : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground",
              )}
            >
              <item.icon size={20} strokeWidth={isActive ? 2.5 : 2} />
              {!collapsed && (
                <motion.span
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="text-sm font-medium"
                >
                  {item.label}
                </motion.span>
              )}
              {collapsed && isActive && (
                <div className="absolute left-full z-50 ml-2 whitespace-nowrap rounded bg-popover p-2 text-xs text-popover-foreground shadow-lg">
                  {item.label}
                </div>
              )}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-sidebar-border p-4">
        {!collapsed && (
          <div className="mb-3 flex items-center gap-3 rounded-lg bg-sidebar-accent px-3 py-2.5">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/20 text-primary text-xs font-bold">
              C
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-semibold text-sidebar-foreground">Your Venue</p>
              <p className="truncate text-xs text-sidebar-foreground/50">CheersAI</p>
            </div>
          </div>
        )}
        {collapsed && (
          <div className="mb-3 flex justify-center">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/20 text-primary text-xs font-bold">
              C
            </div>
          </div>
        )}
        <form action={signOut}>
          <SidebarSignOutButton collapsed={collapsed} />
        </form>
      </div>
    </motion.aside>
  );
}

function SidebarSignOutButton({ collapsed }: { collapsed: boolean }) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className={cn(
        "flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-sidebar-foreground/70 transition-colors hover:bg-destructive/10 hover:text-destructive disabled:cursor-not-allowed disabled:opacity-60",
        collapsed && "justify-center px-0",
      )}
    >
      <LogOut size={20} />
      {!collapsed && <span className="text-sm font-medium">{pending ? "Signing out..." : "Sign out"}</span>}
    </button>
  );
}
