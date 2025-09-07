"use client";

import PublishResultRow from "@/components/publishing/PublishResultRow";

type Result = { connectionId: string; success: boolean; error?: string; scheduled?: boolean };

type Connection = {
  id: string;
  platform: string;
  account_name: string;
  page_name?: string;
};

type Props = {
  results: Result[];
  connections: Connection[];
};

export default function PublishResultsList({ results, connections }: Props) {
  return (
    <div className="space-y-2">
      {results.map((r) => {
        const c = connections.find((x) => x.id === r.connectionId);
        const name = c?.page_name || c?.account_name || 'Account';
        return (
          <PublishResultRow
            key={r.connectionId}
            platform={c?.platform || ''}
            name={name}
            success={!!r.success}
            scheduled={!!r.scheduled}
            error={r.error}
          />
        );
      })}
    </div>
  );
}

