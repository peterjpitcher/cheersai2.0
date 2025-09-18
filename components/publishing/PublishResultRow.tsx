"use client";

import { CheckCircle2, XCircle, Clock } from "lucide-react";

type Props = {
  platform: string;
  name: string;
  scheduled?: boolean;
  success: boolean;
  error?: string;
};

export default function PublishResultRow({ platform, name, scheduled, success, error }: Props) {
  return (
    <div className="flex items-start justify-between rounded-medium border bg-card p-3 text-card-foreground shadow-sm">
      <div>
        <p className="text-sm font-medium">
          {name}
          <span className="ml-2 text-xs text-text-secondary">{platformLabel(platform)}</span>
        </p>
        {scheduled && (
          <p className="mt-1 flex items-center gap-1 text-xs text-text-secondary">
            <Clock className="size-3.5" /> Scheduled
          </p>
        )}
        {!success && error && (
          <p className="mt-1 text-xs text-destructive">{error}</p>
        )}
      </div>
      <div className="ml-3 shrink-0">
        {success ? (
          <span className="inline-flex items-center text-green-600">
            <CheckCircle2 className="mr-1 size-5" />
            <span className="text-sm">{scheduled ? 'Scheduled' : 'Published'}</span>
          </span>
        ) : (
          <span className="inline-flex items-center text-destructive">
            <XCircle className="mr-1 size-5" />
            <span className="text-sm">Failed</span>
          </span>
        )}
      </div>
    </div>
  );
}

function platformLabel(p: string): string {
  switch ((p || '').toLowerCase()) {
    case 'facebook':
      return 'Facebook';
    case 'instagram':
    case 'instagram_business':
      return 'Instagram';
    case 'google_my_business':
      return 'Google Business Profile';
    
    default:
      return p;
  }
}
