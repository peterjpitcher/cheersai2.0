"use client";

import * as React from "react";
import AppHeader from "@/components/layout/app-header";

type MinimalUser = { email: string; avatarUrl?: string; firstName?: string };

type TopbarProps = {
  user: MinimalUser;
  breadcrumb?: Array<{ href: string; label: string }>;
  title?: string;
  notificationCount?: number;
};

// Wrapper for the site header to provide an explicit banner role
export function Topbar(props: TopbarProps) {
  return (
    <div role="banner">
      <AppHeader {...props} />
    </div>
  );
}

