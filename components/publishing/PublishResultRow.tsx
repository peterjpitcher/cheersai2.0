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
    <div className="flex items-start justify-between p-3 rounded-medium border bg-card text-card-foreground shadow-sm">
      <div>
        <p className="text-sm font-medium">
          {name}
          <span className="ml-2 text-xs text-text-secondary">{platformLabel(platform)}</span>
        </p>
        {scheduled && (
          <p className="text-xs text-text-secondary mt-1 flex items-center gap-1">
            <Clock className="w-3.5 h-3.5" /> Scheduled
          </p>
        )}
        {!success && error && (
          <p className="text-xs text-destructive mt-1">{error}</p>
        )}
      </div>
      <div className="ml-3 flex-shrink-0">
        {success ? (
          <span className="inline-flex items-center text-green-600">
            <CheckCircle2 className="w-5 h-5 mr-1" />
            <span className="text-sm">{scheduled ? 'Scheduled' : 'Published'}</span>
          </span>
        ) : (
          <span className="inline-flex items-center text-destructive">
            <XCircle className="w-5 h-5 mr-1" />
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
    case 'twitter':
      return 'Twitter/X';
    default:
      return p;
  }
}
