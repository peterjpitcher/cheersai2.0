import type { ReactNode } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { createServerSupabaseClient } from "@/lib/supabase/server";

interface AuthLayoutProps {
  children: ReactNode;
}

export default async function AuthLayout({ children }: AuthLayoutProps) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    redirect("/planner");
  }

  return (
    <div className="grid min-h-svh lg:grid-cols-2">
      <div className="flex flex-col gap-4 p-6 md:p-10 relative">
        <div className="flex justify-center gap-2 md:justify-start absolute top-6 left-6 md:static">
          <Link href="/" className="flex items-center gap-2 font-medium">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-navy text-white text-lg font-bold">
              C
            </div>
            <span className="font-heading font-bold text-xl tracking-tight text-brand-navy dark:text-white">CheersAI</span>
          </Link>
        </div>
        <div className="flex flex-1 items-center justify-center">
          <div className="w-full max-w-md space-y-6">
            {children}
          </div>
        </div>
      </div>
      <div className="relative hidden bg-brand-navy lg:block overflow-hidden">
        <div className="absolute inset-0 bg-[url('https://images.unsplash.com/photo-1557804506-669a67965ba0?q=80&w=3348&auto=format&fit=crop')] bg-cover bg-center opacity-40 mix-blend-overlay" />
        <div className="absolute inset-0 bg-gradient-to-t from-brand-navy via-brand-navy/50 to-transparent" />

        <div className="absolute inset-x-0 bottom-0 p-12 text-white z-20">
          <blockquote className="space-y-4 max-w-lg">
            <p className="text-2xl font-heading font-medium leading-relaxed">
              &ldquo;CheersAI has completely transformed how we handle our digital presence. It feels less like a tool and more like a partner.&rdquo;
            </p>
            <footer className="flex items-center gap-4 pt-4">
              <div className="h-10 w-10 rounded-full bg-white/20 backdrop-blur-sm" />
              <div>
                <div className="font-semibold">Sarah Jenkins</div>
                <div className="text-white/70 text-sm">General Manager, The Dukes Head</div>
              </div>
            </footer>
          </blockquote>
        </div>
      </div>
    </div>
  );
}
