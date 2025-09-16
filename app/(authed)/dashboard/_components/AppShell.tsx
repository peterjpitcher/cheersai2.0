"use client";

import * as React from "react";

type AppShellProps = {
  children: React.ReactNode;
  className?: string;
};

// Minimal wrapper to provide the main landmark without altering visuals
export function AppShell({ children, className }: AppShellProps) {
  return (
    <main role="main" className={className}>
      {children}
    </main>
  );
}

