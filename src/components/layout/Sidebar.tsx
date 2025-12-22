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
    Share2
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
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
            className="h-screen sticky top-0 hidden md:flex flex-col border-r border-border bg-sidebar text-sidebar-foreground z-30"
        >
            {/* Header */}
            <div className="h-16 flex items-center justify-between px-4 border-b border-sidebar-border">
                {!collapsed && (
                    <span className="font-heading font-bold text-xl tracking-tight text-primary">
                        CheersAI
                    </span>
                )}
                <button
                    onClick={() => setCollapsed(!collapsed)}
                    className="p-1.5 rounded-md hover:bg-sidebar-accent text-sidebar-foreground/70 transition-colors"
                >
                    {collapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
                </button>
            </div>

            {/* Navigation */}
            <nav className="flex-1 py-6 px-3 space-y-1">
                {NAV_ITEMS.map((item) => {
                    const isActive = pathname === item.href;
                    return (
                        <Link
                            key={item.href}
                            href={item.href}
                            className={cn(
                                "flex items-center gap-3 px-3 py-2.5 rounded-md transition-all duration-200 group relative",
                                isActive
                                    ? "bg-sidebar-primary text-sidebar-primary-foreground shadow-md"
                                    : "hover:bg-sidebar-accent text-sidebar-foreground/80 hover:text-sidebar-foreground"
                            )}
                        >
                            <item.icon size={20} strokeWidth={isActive ? 2.5 : 2} />
                            {!collapsed && (
                                <motion.span
                                    initial={{ opacity: 0 }}
                                    animate={{ opacity: 1 }}
                                    className="font-medium text-sm"
                                >
                                    {item.label}
                                </motion.span>
                            )}
                            {collapsed && isActive && (
                                <div className="absolute left-full ml-2 p-2 bg-popover text-popover-foreground text-xs rounded shadow-lg whitespace-nowrap z-50">
                                    {item.label}
                                </div>
                            )}
                        </Link>
                    );
                })}
            </nav>

            {/* Footer */}
            <div className="p-4 border-t border-sidebar-border">
                <button className={cn(
                    "flex items-center gap-3 w-full px-3 py-2.5 rounded-md hover:bg-red-50 hover:text-red-600 transition-colors text-sidebar-foreground/70",
                    collapsed && "justify-center px-0"
                )}>
                    <LogOut size={20} />
                    {!collapsed && <span className="font-medium text-sm">Sign Out</span>}
                </button>
            </div>
        </motion.aside>
    );
}
