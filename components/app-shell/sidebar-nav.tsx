"use client";

import * as React from "react";
import SubNav from "@/components/navigation/sub-nav";
import type { SubNavPreset, NavItem } from "@/lib/nav";

type SidebarNavProps = {
  base: string;
  preset?: SubNavPreset;
  itemsOverride?: NavItem[];
  title?: string;
  subtitle?: string;
  actions?: React.ReactNode;
  className?: string;
  ariaLabel?: string;
};

export function SidebarNav({ ariaLabel = "Section navigation", ...props }: SidebarNavProps) {
  return (
    <nav role="navigation" aria-label={ariaLabel}>
      <SubNav {...props} />
    </nav>
  );
}

