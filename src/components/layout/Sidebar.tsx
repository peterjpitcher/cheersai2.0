"use client";

import { motion } from "framer-motion";
import {
  CalendarDays,
  Settings,
  LogOut,
  ChevronLeft,
  ChevronRight,
  PlusCircle,
  Image,
  Share2,
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
        {!collapsed && (
          <span className="font-heading text-xl font-bold tracking-tight text-primary">
            CheersAI
          </span>
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
                  ? "bg-sidebar-primary text-sidebar-primary-foreground shadow-md"
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
        "flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-sidebar-foreground/70 transition-colors hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-60",
        collapsed && "justify-center px-0",
      )}
    >
      <LogOut size={20} />
      {!collapsed && <span className="text-sm font-medium">{pending ? "Signing out..." : "Sign out"}</span>}
    </button>
  );
}
