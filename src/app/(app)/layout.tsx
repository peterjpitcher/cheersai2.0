import { ReactNode } from "react";

import { AppShell } from "@/components/layout/AppShell";
import { AuthProvider } from "@/components/providers/auth-provider";
import { getCurrentUser } from "@/lib/auth/server";

interface AppLayoutProps {
  children: ReactNode;
}

export default async function AppLayout({ children }: AppLayoutProps) {
  const user = await getCurrentUser();

  return (
    <AuthProvider value={user}>
      <AppShell>{children}</AppShell>
    </AuthProvider>
  );
}
