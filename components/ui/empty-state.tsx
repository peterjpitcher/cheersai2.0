"use client";

import Link from "next/link";
import { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type CTA = {
  label: string;
  href?: string;
  onClick?: () => void;
  variant?: "default" | "secondary" | "outline" | "destructive";
};

interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  body?: ReactNode;
  primaryCta?: CTA;
  secondaryCta?: CTA;
  className?: string;
}

export default function EmptyState({
  icon,
  title,
  body,
  primaryCta,
  secondaryCta,
  className,
}: EmptyStateProps) {
  return (
    <div className={cn("text-center py-16 rounded-lg border bg-card text-card-foreground shadow-sm", className)}>
      {icon && (
        <div className="mx-auto mb-6 flex size-20 items-center justify-center rounded-full bg-primary/10">
          <div className="text-primary">{icon}</div>
        </div>
      )}
      <h2 className="mb-2 font-heading text-2xl font-bold">{title}</h2>
      {body && <div className="mx-auto mb-6 max-w-md text-text-secondary">{body}</div>}
      <div className="flex items-center justify-center gap-3">
        {secondaryCta && (
          secondaryCta.href ? (
            <Link href={secondaryCta.href} className="inline-flex">
              <Button variant={secondaryCta.variant || "outline"}>{secondaryCta.label}</Button>
            </Link>
          ) : (
            <Button variant={secondaryCta.variant || "outline"} onClick={secondaryCta.onClick}>
              {secondaryCta.label}
            </Button>
          )
        )}
        {primaryCta && (
          primaryCta.href ? (
            <Link href={primaryCta.href} className="inline-flex">
              <Button>{primaryCta.label}</Button>
            </Link>
          ) : (
            <Button onClick={primaryCta.onClick}>{primaryCta.label}</Button>
          )
        )}
      </div>
    </div>
  );
}

