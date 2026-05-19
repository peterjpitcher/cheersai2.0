import type React from "react";

interface PageHeaderProps {
  title: string;
  description?: string;
  action?: React.ReactNode;
}

export function PageHeader({ title, description, action }: PageHeaderProps) {
  return (
    <header className="mb-8 flex flex-col gap-4 py-6 md:flex-row md:items-center md:justify-between">
      <div>
        <h1 className="font-heading text-3xl font-bold tracking-tight" style={{ color: "var(--c-ink)" }}>{title}</h1>
        {description && <p className="mt-1 text-sm md:text-base" style={{ color: "var(--c-ink-3)" }}>{description}</p>}
      </div>

      {action && <div className="flex items-center gap-2">{action}</div>}
    </header>
  );
}

/** @deprecated TopRail (Wave 3) handles global navigation. This stub is kept for AppShell compatibility. */
export function Topbar(): React.ReactNode {
  return null;
}
