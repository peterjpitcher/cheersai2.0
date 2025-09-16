"use client";

import * as React from "react";

type AppShellProps = {
  children: React.ReactNode;
  className?: string;
};

export function AppShell({ children, className }: AppShellProps) {
  return (
    <main role="main" className={className}>
      {children}
    </main>
  );
}

