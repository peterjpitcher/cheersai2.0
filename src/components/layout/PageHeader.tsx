"use client";

import Link from "next/link";
import { Bell, Menu, Search } from "lucide-react";
import { usePathname } from "next/navigation";
import { useFormStatus } from "react-dom";

import { signOut } from "@/lib/auth/actions";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";

interface PageHeaderProps {
  title: string;
  description?: string;
  action?: React.ReactNode;
}

export function PageHeader({ title, description, action }: PageHeaderProps) {
  return (
    <header className="mb-8 flex flex-col gap-4 py-6 md:flex-row md:items-center md:justify-between">
      <div>
        <h1 className="font-heading text-3xl font-bold tracking-tight text-foreground">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted-foreground md:text-base">{description}</p>}
      </div>

      {action && <div className="flex items-center gap-2">{action}</div>}
    </header>
  );
}

export function Topbar() {
  return (
    <div className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-border bg-background/80 px-6 backdrop-blur-md md:px-8">
      <div className="flex items-center gap-4">
        <MobileNav />
        <div className="relative hidden w-64 md:block lg:w-80">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search..."
            className="w-full rounded-full border-none bg-secondary/50 py-1.5 pl-9 pr-4 text-sm outline-none transition-all focus:ring-1 focus:ring-primary"
          />
        </div>
      </div>

      <div className="flex items-center gap-3">
        <Link
          href="/planner/notifications"
          className="relative rounded-full p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <Bell className="h-5 w-5" />
          <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full border border-background bg-destructive" />
        </Link>
        <div className="h-8 w-8 rounded-full bg-gradient-to-br from-brand-navy to-brand-teal ring-2 ring-white/10" />
      </div>
    </div>
  );
}

const NAV_ITEMS = [
  { label: "Planner", href: "/planner" },
  { label: "Create", href: "/create" },
  { label: "Library", href: "/library" },
  { label: "Connections", href: "/connections" },
  { label: "Settings", href: "/settings" },
];

function MobileNav() {
  const pathname = usePathname();

  return (
    <Sheet>
      <SheetTrigger asChild>
        <button
          type="button"
          className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-border text-foreground transition hover:bg-accent md:hidden"
          aria-label="Open navigation"
        >
          <Menu className="h-4 w-4" />
        </button>
      </SheetTrigger>
      <SheetContent side="left" className="w-72 p-6">
        <SheetHeader>
          <SheetTitle>CheersAI</SheetTitle>
        </SheetHeader>
        <nav className="mt-6 flex flex-col gap-2">
          {NAV_ITEMS.map((item) => {
            const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`rounded-lg px-3 py-2 text-sm font-medium transition ${
                  isActive ? "bg-primary text-primary-foreground" : "text-foreground hover:bg-accent"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
        <form action={signOut} className="mt-6">
          <MobileSignOutButton />
        </form>
      </SheetContent>
    </Sheet>
  );
}

function MobileSignOutButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-lg border border-border px-3 py-2 text-sm font-semibold text-foreground transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? "Signing out..." : "Sign out"}
    </button>
  );
}
