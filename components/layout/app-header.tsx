"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, Bell } from "lucide-react";
import { useEffect, useState } from "react";
import { mainNav } from "@/lib/nav";
import BrandLogo from "@/components/ui/BrandLogo";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { UserMenu } from "@/components/navigation/user-menu";
import { useAuth } from "@/components/auth/auth-provider";
import { formatPlanLabel } from "@/lib/copy";

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
  // Guard to avoid any SSR/client mismatch by ensuring interactive Radix content mounts consistently
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const { tenantData } = useAuth();
  const planLabel = formatPlanLabel(tenantData?.subscription_tier || null);

  const headerNav = mainNav.map(i => ({ label: i.label, href: i.to }));

  return (
    <header className="sticky top-0 z-50 border-b border-border bg-surface">
      <div className="container mx-auto flex max-w-screen-2xl items-center justify-between gap-4 p-4">
        {/* Left: Logo + breadcrumb */}
        <div className="flex min-w-0 items-center gap-4">
          <Link href="/dashboard" className="shrink-0">
            <BrandLogo variant="header" className="max-h-11 h-auto w-auto" />
          </Link>
          {breadcrumb.length > 0 && (
            <nav aria-label="Breadcrumb" className="hidden truncate text-sm text-text-secondary sm:block">
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
          <h1 className="hidden flex-1 truncate text-center font-heading text-lg font-semibold md:block">
            {title}
          </h1>
        )}

        {/* Right: plan badge + actions + user menu */}
        <div className="flex items-center gap-3">
          {planLabel && (
            <span className="hidden items-center rounded-full bg-primary/10 px-2 py-1 text-xs font-medium text-primary sm:inline-flex">
              {planLabel}
            </span>
          )}
          <Link href="/notifications" className="relative rounded-medium p-2 hover:bg-background">
            <Bell className="size-5" />
            {notificationCount > 0 && (
              <span className="absolute -right-1 -top-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] text-white">
                {notificationCount}
              </span>
            )}
            <span className="sr-only">Notifications</span>
          </Link>
          <UserMenu user={{ email: user.email, avatarUrl: user.avatarUrl }} notificationCount={notificationCount} />
          {mounted && (
            <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
              <SheetTrigger className="rounded-medium p-2 hover:bg-background md:hidden" aria-label="Open menu">
                <Menu className="size-5" />
              </SheetTrigger>
              <SheetContent side="left" className="w-80">
                <nav className="mt-4 grid gap-1">
                  {headerNav.map((item) => (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => setMobileOpen(false)}
                      className={`rounded-medium px-3 py-2 text-sm ${
                        pathname.startsWith(item.href) ? 'bg-primary/10 text-primary' : 'hover:bg-background'
                      }`}
                    >
                      {item.label}
                    </Link>
                  ))}
                </nav>
              </SheetContent>
            </Sheet>
          )}
        </div>
      </div>
    </header>
  );
}
