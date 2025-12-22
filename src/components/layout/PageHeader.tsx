"use client";

import { Bell, Search } from "lucide-react";

interface PageHeaderProps {
    title: string;
    description?: string;
    action?: React.ReactNode;
}

export function PageHeader({ title, description, action }: PageHeaderProps) {
    return (
        <header className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between py-6 mb-8">
            <div>
                <h1 className="text-3xl font-heading font-bold text-foreground tracking-tight">
                    {title}
                </h1>
                {description && (
                    <p className="text-muted-foreground mt-1 text-sm md:text-base">
                        {description}
                    </p>
                )}
            </div>

            {action && (
                <div className="flex items-center gap-2">
                    {action}
                </div>
            )}
        </header>
    );
}

export function Topbar() {
    return (
        <div className="h-16 border-b border-border bg-background/80 backdrop-blur-md sticky top-0 z-20 flex items-center justify-between px-6 md:px-8">
            <div className="flex items-center gap-4 w-full max-w-md">
                <div className="relative w-full">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground h-4 w-4" />
                    <input
                        type="text"
                        placeholder="Search..."
                        className="w-full bg-secondary/50 border-none rounded-full pl-9 pr-4 py-1.5 text-sm focus:ring-1 focus:ring-primary outline-none transition-all"
                    />
                </div>
            </div>

            <div className="flex items-center gap-3">
                <button className="p-2 rounded-full hover:bg-accent text-muted-foreground hover:text-foreground transition-colors relative">
                    <Bell className="h-5 w-5" />
                    <span className="absolute top-1.5 right-1.5 h-2 w-2 bg-destructive rounded-full border border-background" />
                </button>
                <div className="h-8 w-8 rounded-full bg-gradient-to-br from-brand-navy to-brand-teal ring-2 ring-white/10" />
            </div>
        </div>
    );
}
