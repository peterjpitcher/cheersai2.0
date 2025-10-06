"use client";

import { ReactNode, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";

import { ToastProvider } from "@/components/providers/toast-provider";
import { AuthProvider } from "@/components/providers/auth-provider";
import type { AppUser } from "@/lib/auth/types";

interface AppProvidersProps {
  children: ReactNode;
  user?: AppUser | null;
}

export function AppProviders({ children, user = null }: AppProvidersProps) {
  const [queryClient] = useState(() => new QueryClient());

  return (
    <AuthProvider value={user}>
      <QueryClientProvider client={queryClient}>
        <ToastProvider>{children}</ToastProvider>
        <ReactQueryDevtools initialIsOpen={false} />
      </QueryClientProvider>
    </AuthProvider>
  );
}
