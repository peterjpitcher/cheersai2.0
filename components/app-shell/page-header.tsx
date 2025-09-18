import * as React from "react";
import Container from "@/components/layout/container";

type PageHeaderProps = {
  title?: string;
  subtitle?: string;
  actions?: React.ReactNode;
  className?: string;
};

export function PageHeader({ title, subtitle, actions, className }: PageHeaderProps) {
  if (!title && !subtitle && !actions) return null;
  return (
    <div className={className}>
      <Container className="py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            {title && <h1 className="truncate font-heading text-title-sm font-semibold">{title}</h1>}
            {subtitle && <p className="truncate text-sm text-text-secondary">{subtitle}</p>}
          </div>
          {actions && (
            <div className="flex items-center gap-2" role="group" aria-label="Page actions">
              {actions}
            </div>
          )}
        </div>
      </Container>
    </div>
  );
}

