"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, Bell } from "lucide-react";
import { useState } from "react";
import Logo from "@/components/ui/logo";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { UserMenu } from "@/components/navigation/user-menu";

type MinimalUser = {
  email: string;
  avatarUrl?: string;
  firstName?: string;
};

interface AppHeaderProps {
  user: MinimalUser;
  breadcrumb?: Array<{ href: string; label: string }>;
  title?: string;
  notificationCount?: number;
}

export default function AppHeader({ user, breadcrumb = [], title, notificationCount = 0 }: AppHeaderProps) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  const mainNav = [
    { label: "Dashboard", href: "/dashboard" },
    { label: "Campaigns", href: "/campaigns" },
    { label: "Media", href: "/media" },
    { label: "Settings", href: "/settings" },
  ];

  return (
    <header className="sticky top-0 z-50 bg-surface border-b border-border">
      <div className="container mx-auto max-w-screen-2xl px-4 py-4 flex items-center justify-between gap-4">
        {/* Left: Logo + breadcrumb */}
        <div className="flex items-center gap-4 min-w-0">
          <Link href="/dashboard" className="shrink-0">
            <Logo variant="compact" className="h-11" />
          </Link>
          {breadcrumb.length > 0 && (
            <nav aria-label="Breadcrumb" className="hidden sm:block text-sm text-text-secondary truncate">
              {breadcrumb.map((b, i) => (
                <span key={b.href} className="whitespace-nowrap">
                  <Link href={b.href} className="hover:text-text-primary">{b.label}</Link>
                  {i < breadcrumb.length - 1 && <span className="mx-2 text-text-secondary">/</span>}
                </span>
              ))}
            </nav>
          )}
        </div>

        {/* Centre: Optional title (can be replaced by search later) */}
        {title && (
          <h1 className="hidden md:block text-lg font-heading font-semibold truncate flex-1 text-center">
            {title}
          </h1>
        )}

        {/* Right: actions + user menu */}
        <div className="flex items-center gap-3">
          <Link href="/notifications" className="relative p-2 rounded-medium hover:bg-background">
            <Bell className="w-5 h-5" />
            {notificationCount > 0 && (
              <span className="absolute -top-1 -right-1 inline-flex items-center justify-center h-4 min-w-4 px-1 text-[10px] rounded-full bg-primary text-white">
                {notificationCount}
              </span>
            )}
            <span className="sr-only">Notifications</span>
          </Link>
          <UserMenu user={{ email: user.email, avatarUrl: user.avatarUrl }} notificationCount={notificationCount} />
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger className="md:hidden p-2 rounded-medium hover:bg-background" aria-label="Open menu">
              <Menu className="w-5 h-5" />
            </SheetTrigger>
            <SheetContent side="left" className="w-80">
              <nav className="mt-4 grid gap-1">
                {mainNav.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setMobileOpen(false)}
                    className={`px-3 py-2 rounded-medium text-sm ${
                      pathname.startsWith(item.href) ? 'bg-primary/10 text-primary' : 'hover:bg-background'
                    }`}
                  >
                    {item.label}
                  </Link>
                ))}
              </nav>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
  );
}

