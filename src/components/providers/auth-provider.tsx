"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";

import type { AppUser } from "@/lib/auth/types";

const AuthContext = createContext<AppUser | null>(null);

interface AuthProviderProps {
  value: AppUser | null;
  children: ReactNode;
}

export function AuthProvider({ value, children }: AuthProviderProps) {
  const memoisedValue = useMemo(() => value, [value]);
  return <AuthContext.Provider value={memoisedValue}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
