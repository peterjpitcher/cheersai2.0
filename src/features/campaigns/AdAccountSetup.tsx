"use client";

import { useEffect, useState, useTransition } from "react";
import { useSearchParams } from "next/navigation";

import {
  fetchAdAccounts,
  selectAdAccount,
  startAdsOAuth,
} from "@/app/(app)/connections/actions-ads";
import { useToast } from "@/components/providers/toast-provider";

interface AdAccountSetupProps {
  initialStatus: {
    connected: boolean;
    setupComplete: boolean;
    tokenExpiringSoon: boolean;
  };
}

interface AdAccountOption {
  id: string;
  name: string;
  currency: string;
  timezoneName: string;
}

export function AdAccountSetup({ initialStatus }: AdAccountSetupProps) {
  const toast = useToast();
  const searchParams = useSearchParams();
  const [isPendingOAuth, startOAuthTransition] = useTransition();
  const [isPendingSelect, startSelectTransition] = useTransition();

  const [accounts, setAccounts] = useState<AdAccountOption[]>([]);
  const [loadingAccounts, setLoadingAccounts] = useState(false);
  const [accountsError, setAccountsError] = useState<string | null>(null);

  // Derive connected state from either initialStatus or the ads_step URL param
  // (the callback redirects to ?ads_step=select_account after a successful token exchange)
  const adsStep = searchParams.get("ads_step");
  const adsError = searchParams.get("ads_error");
  const isConnected = initialStatus.connected || adsStep === "select_account";

  // Show error from OAuth callback if present
  useEffect(() => {
    if (adsError) {
      toast.error("Meta Ads connection failed", { description: adsError.replace(/_/g, " ") });
    }
  }, [adsError, toast]);

  // Fetch ad accounts when connected but setup not complete
  useEffect(() => {
    if (!isConnected || initialStatus.setupComplete) return;

    setLoadingAccounts(true);
    fetchAdAccounts()
      .then((result) => {
        if (result.success) {
          setAccounts(result.accounts);
        } else {
          setAccountsError(result.error);
        }
      })
      .catch((err) => {
        const message = err instanceof Error ? err.message : "Failed to load ad accounts.";
        setAccountsError(message);
      })
      .finally(() => {
        setLoadingAccounts(false);
      });
  }, [isConnected, initialStatus.setupComplete]);

  const handleConnectClick = () => {
    startOAuthTransition(async () => {
      try {
        const result = await startAdsOAuth();
        if (!result?.url) {
          throw new Error("Missing redirect URL");
        }
        toast.success("Redirecting to Meta…");
        window.location.href = result.url;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Something went wrong";
        toast.error("Could not start Meta Ads OAuth flow", { description: message });
      }
    });
  };

  const handleSelectAccount = (metaAccountId: string, accountName: string) => {
    startSelectTransition(async () => {
      try {
        const result = await selectAdAccount(metaAccountId);
        if (result.error) {
          toast.error("Could not select ad account", { description: result.error });
        } else {
          toast.success(`Ad account "${accountName}" selected`);
          // Reload to reflect the updated setup status
          window.location.reload();
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Something went wrong";
        toast.error("Could not select ad account", { description: message });
      }
    });
  };

  // Setup complete state
  if (initialStatus.setupComplete) {
    return (
      <div className="flex items-start justify-between gap-4 rounded-lg border border-green-200 bg-green-50 px-4 py-3 dark:border-green-900/40 dark:bg-green-950/30">
        <div className="space-y-0.5">
          <p className="text-sm font-semibold text-green-800 dark:text-green-300">
            Meta Ads connected
          </p>
          <p className="text-xs text-green-700 dark:text-green-400">
            Your ad account is set up and ready for campaigns.
          </p>
        </div>
        {initialStatus.tokenExpiringSoon && (
          <button
            type="button"
            onClick={handleConnectClick}
            disabled={isPendingOAuth}
            className="shrink-0 rounded-full border border-brand-navy bg-brand-navy px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-navy/90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isPendingOAuth ? "Redirecting…" : "Reconnect"}
          </button>
        )}
      </div>
    );
  }

  // Connected but ad account not yet selected
  if (isConnected) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Choose which ad account to use for campaigns:
        </p>

        {loadingAccounts && (
          <p className="text-sm text-muted-foreground">Loading ad accounts…</p>
        )}

        {accountsError && (
          <p className="text-sm text-destructive">{accountsError}</p>
        )}

        {!loadingAccounts && !accountsError && accounts.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No ad accounts found on this Meta connection.
          </p>
        )}

        {accounts.length > 0 && (
          <ul className="space-y-2">
            {accounts.map((account) => (
              <li
                key={account.id}
                className="flex items-center justify-between gap-4 rounded-lg border border-white/30 bg-white/70 px-4 py-3 shadow-sm backdrop-blur-sm dark:bg-slate-900/60"
              >
                <div className="space-y-0.5">
                  <p className="text-sm font-medium text-foreground">{account.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {account.currency} · {account.timezoneName}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => handleSelectAccount(account.id, account.name)}
                  disabled={isPendingSelect}
                  className="shrink-0 rounded-full border border-brand-navy bg-brand-navy px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-navy/90 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isPendingSelect ? "Selecting…" : "Select"}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  // Not connected — show connect button
  return (
    <button
      type="button"
      onClick={handleConnectClick}
      disabled={isPendingOAuth}
      className="rounded-full border border-brand-navy bg-brand-navy px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-navy/90 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {isPendingOAuth ? "Redirecting…" : "Connect Meta Ads"}
    </button>
  );
}
