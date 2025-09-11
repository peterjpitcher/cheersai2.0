"use client";

import { useState } from "react";
import { toast } from "sonner";
import { CheckCircle, XCircle, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/lib/datetime";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

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
      if (!res.ok) throw new Error((json?.error && (json?.error?.message || json.error)) || "Verification failed");
      const payload = json?.data || json || {};
      setChecks(payload.checks || []);
      setStatus(payload.status || null);
      setVerifiedAt(payload.verifiedAt || null);
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
        <span className={`text-xs ${statusClass}`}>Last checked {formatDateTime(verifiedAt)}</span>
      )}
      <Button onClick={runVerify} loading={loading} size="sm" title="Run connection health check">
        Verify
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg p-0">
          <DialogHeader className="px-6 py-4">
            <DialogTitle className="flex items-center gap-2">
              {status && <StatusIcon className={`w-5 h-5 ${statusClass}`} />}
              Verification Results
            </DialogTitle>
            {verifiedAt && (
              <div className="text-xs text-text-secondary">{formatDateTime(verifiedAt)}</div>
            )}
          </DialogHeader>
          <div className="divide-y border rounded-medium mx-6 mb-6">
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
        </DialogContent>
      </Dialog>
    </div>
  );
}
