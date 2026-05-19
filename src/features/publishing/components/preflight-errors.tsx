'use client';

/**
 * Preflight error list with fix-it CTAs (CONT-10).
 * Renders plain-English issues from getPublishReadinessIssues with
 * actionable buttons mapped to each issue code.
 */

import { AlertTriangle } from 'lucide-react';
import Link from 'next/link';

interface PreflightErrorsProps {
  issues: Array<{ code: string; message: string }>;
  onAction?: (code: string) => void;
}

interface CtaConfig {
  label: string;
  href?: string;
}

/**
 * Map issue codes to CTA labels and optional navigation links.
 * Connection issues link to settings; content issues call onAction.
 */
function getCtaConfig(code: string): CtaConfig {
  switch (code) {
    case 'connection_missing':
    case 'connection_needs_action':
    case 'connection_token_missing':
    case 'connection_token_expired':
      return { label: 'Go to Connections', href: '/settings/connections' };

    case 'connection_metadata_missing':
      return { label: 'Update in Connections', href: '/settings/connections' };

    case 'placement_invalid':
      return { label: 'Change placement' };

    case 'lint_failed':
      return { label: 'Regenerate content' };

    case 'body_missing':
      return { label: 'Add post copy' };

    case 'media_missing':
    case 'media_story_count':
    case 'media_missing_assets':
    case 'media_story_type':
    case 'media_story_derivative_missing':
      return { label: 'Fix media' };

    default:
      return { label: 'Fix issue' };
  }
}

export function PreflightErrors({ issues, onAction }: PreflightErrorsProps): React.JSX.Element | null {
  if (issues.length === 0) return null;

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950">
      <h3 className="mb-3 text-sm font-semibold text-amber-900 dark:text-amber-100">
        This post is not ready to publish
      </h3>
      <ul className="space-y-3">
        {issues.map((issue) => {
          const cta = getCtaConfig(issue.code);

          return (
            <li key={issue.code} className="flex items-start gap-3">
              <AlertTriangle
                className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400"
                aria-hidden="true"
              />
              <div className="flex-1 text-sm text-amber-800 dark:text-amber-200">
                <p>{issue.message}</p>
              </div>
              {cta.href ? (
                <Link
                  href={cta.href}
                  className="shrink-0 rounded-md bg-amber-100 px-3 py-1 text-xs font-medium text-amber-800 hover:bg-amber-200 dark:bg-amber-900 dark:text-amber-200 dark:hover:bg-amber-800"
                >
                  {cta.label}
                </Link>
              ) : (
                <button
                  type="button"
                  onClick={() => onAction?.(issue.code)}
                  className="shrink-0 rounded-md bg-amber-100 px-3 py-1 text-xs font-medium text-amber-800 hover:bg-amber-200 dark:bg-amber-900 dark:text-amber-200 dark:hover:bg-amber-800"
                >
                  {cta.label}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
