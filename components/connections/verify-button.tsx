"use client";

import { useState } from "react";
import { toast } from "sonner";
import { CheckCircle, XCircle, AlertCircle, Loader2 } from "lucide-react";

interface Props {
  connectionId: string;
  lastVerifiedAt?: string | null;
  verifyStatus?: "pass" | "fail" | "warning" | null;
}

export default function VerifyButton({ connectionId, lastVerifiedAt, verifyStatus }: Props) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [checks, setChecks] = useState<Array<{ id: string; label: string; ok: boolean; hint?: string }>>([]);
  const [status, setStatus] = useState<"pass" | "fail" | "warning" | null>(verifyStatus ?? null);
  const [verifiedAt, setVerifiedAt] = useState<string | null>(lastVerifiedAt ?? null);

  const runVerify = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/social/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ connectionId })
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Verification failed");
      setChecks(json.checks || []);
      setStatus(json.status || null);
      setVerifiedAt(json.verifiedAt || null);
      setOpen(true);
    } catch (e: any) {
      toast.error(e?.message || "Verification failed");
    } finally {
      setLoading(false);
    }
  };

  const StatusIcon = status === "pass" ? CheckCircle : status === "fail" ? XCircle : AlertCircle;
  const statusClass = status === "pass" ? "text-success" : status === "fail" ? "text-error" : "text-warning";

  return (
    <div className="flex items-center gap-2">
      {verifiedAt && (
        <span className={`text-xs ${statusClass}`}>Last checked {new Date(verifiedAt).toLocaleString("en-GB")}</span>
      )}
      <button
        onClick={runVerify}
        disabled={loading}
        className="text-sm px-3 py-1 bg-primary text-white rounded-medium disabled:opacity-50"
        title="Run connection health check"
      >
        {loading ? (<><Loader2 className="w-3 h-3 inline animate-spin mr-1"/> Verifying…</>) : "Verify"}
      </button>

      {/* Simple modal */}
      {open && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50" onClick={() => setOpen(false)}>
          <div className="bg-white rounded-large border border-border p-4 w-full max-w-lg" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-2 mb-3">
              {status && <StatusIcon className={`w-5 h-5 ${statusClass}`} />}
              <h3 className="font-semibold">Verification Results</h3>
              <div className="ml-auto text-xs text-text-secondary">{verifiedAt && new Date(verifiedAt).toLocaleString("en-GB")}</div>
            </div>
            <div className="divide-y border rounded-medium">
              {checks.map((c) => (
                <div key={c.id} className="p-2 text-sm flex items-start gap-2">
                  {c.ok ? (<CheckCircle className="w-4 h-4 text-success mt-0.5" />) : (<XCircle className="w-4 h-4 text-error mt-0.5" />)}
                  <div className="flex-1">
                    <div className="font-medium">{c.label}</div>
                    {!c.ok && c.hint && (<div className="text-xs text-text-secondary">{c.hint}</div>)}
                  </div>
                </div>
              ))}
            </div>
            <div className="text-right mt-3">
              <button onClick={() => setOpen(false)} className="text-sm px-3 py-1 border border-input rounded-medium">Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

