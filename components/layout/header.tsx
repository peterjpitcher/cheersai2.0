"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X, User, LogOut } from "lucide-react";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import Logo from "@/components/ui/logo";

export default function Header({ user }: { user: any }) {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const handleSignOut = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/");
  };

  const navigation = [
    { name: "Dashboard", href: "/dashboard" },
    { name: "Campaigns", href: "/campaigns" },
    { name: "Media", href: "/media" },
    { name: "Settings", href: "/settings" },
  ];

  return (
    <header className="bg-surface border-b border-border sticky top-0 z-50">
      <nav className="container mx-auto px-4">
        <div className="flex items-center justify-between py-6">
          {/* Logo */}
          <Link href={user ? "/dashboard" : "/"} className="flex items-center">
            <Logo variant="compact" className="h-16" />
          </Link>

          {/* Desktop Navigation */}
          {user && (
            <div className="hidden md:flex items-center gap-6">
              {navigation.map((item) => (
                <Link
                  key={item.name}
                  href={item.href}
                  className={`text-sm font-medium transition-colors ${
                    pathname.startsWith(item.href)
                      ? "text-primary"
                      : "text-text-secondary hover:text-text-primary"
                  }`}
                >
                  {item.name}
                </Link>
              ))}
            </div>
          )}

          {/* User Menu */}
          <div className="flex items-center gap-4">
            {user ? (
              <>
                <Link
                  href="/settings/billing"
                  className="hidden md:inline-flex border border-input rounded-md px-3 py-2 text-sm"
                >
                  Upgrade
                </Link>
                <div className="flex items-center gap-2">
                  <Link
                    href="/settings"
                    className="p-2 rounded-medium hover:bg-background transition-colors"
                  >
                    <User className="w-5 h-5" />
                  </Link>
                  <button
                    onClick={handleSignOut}
                    className="p-2 rounded-medium hover:bg-background transition-colors"
                  >
                    <LogOut className="w-5 h-5" />
                  </button>
                </div>
              </>
            ) : (
              <div className="flex items-center gap-3">
                <Link href="/auth/login" className="text-sm text-text-secondary hover:bg-muted rounded-md px-3 py-2">
                  Sign In
                </Link>
                <Link href="/auth/signup" className="text-sm bg-primary text-white rounded-md px-3 py-2">
                  Get Started
                </Link>
              </div>
            )}

            {/* Mobile Menu Button */}
            {user && (
              <button
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                className="md:hidden p-2"
              >
                {mobileMenuOpen ? (
                  <X className="w-5 h-5" />
                ) : (
                  <Menu className="w-5 h-5" />
                )}
              </button>
            )}
          </div>
        </div>

        {/* Mobile Navigation */}
        {user && mobileMenuOpen && (
          <div className="md:hidden py-4 border-t border-border">
            {navigation.map((item) => (
              <Link
                key={item.name}
                href={item.href}
                onClick={() => setMobileMenuOpen(false)}
                className={`block py-2 text-sm font-medium ${
                  pathname.startsWith(item.href)
                    ? "text-primary"
                    : "text-text-secondary"
                }`}
              >
                {item.name}
              </Link>
            ))}
            <Link
              href="/settings/billing"
              onClick={() => setMobileMenuOpen(false)}
              className="block py-2 text-sm font-medium text-primary"
            >
              Upgrade Plan
            </Link>
          </div>
        )}
      </nav>
    </header>
  );
}
