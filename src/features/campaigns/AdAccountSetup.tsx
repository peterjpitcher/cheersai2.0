"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import {
  disconnectAdAccount,
  fetchAdAccounts,
  selectAdAccount,
  startAdsOAuth,
  type AdAccountSetupStatus,
} from "@/app/(app)/connections/actions-ads";
import { useToast } from "@/components/providers/toast-provider";

interface AdAccountSetupProps {
  initialStatus: AdAccountSetupStatus;
  /** Owners only (decision D4); the server action enforces it too. */
  canDisconnect: boolean;
}

const DISCONNECT_CONFIRMATION =
  "Disconnect Meta Ads? CheersAI will delete its access to your ad account and your Conversions API token. " +
  "You won't be able to create or manage campaigns, and booking conversions stop reaching Meta, until you reconnect and re-enter the token.";

interface AdAccountOption {
  id: string;
  name: string;
  currency: string;
  timezoneName: string;
}

export function AdAccountSetup({ initialStatus, canDisconnect }: AdAccountSetupProps) {
  const toast = useToast();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPendingOAuth, startOAuthTransition] = useTransition();
  const [isPendingSelect, startSelectTransition] = useTransition();
  const [isPendingDisconnect, startDisconnectTransition] = useTransition();

  const [accounts, setAccounts] = useState<AdAccountOption[]>([]);
  const [loadingAccounts, setLoadingAccounts] = useState(false);
  const [accountsError, setAccountsError] = useState<string | null>(null);
  const [selectingAccountId, setSelectingAccountId] = useState<string | null>(null);

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
    if (selectingAccountId) return;

    setSelectingAccountId(metaAccountId);
    startSelectTransition(async () => {
      try {
        const result = await selectAdAccount(metaAccountId);
        if (result.error) {
          toast.error("Could not select ad account", { description: result.error });
          return;
        } else {
          toast.success(`Ad account "${accountName}" selected`);
          router.replace("/connections");
          router.refresh();
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Something went wrong";
        toast.error("Could not select ad account", { description: message });
      } finally {
        setSelectingAccountId(null);
      }
    });
  };

  const handleDisconnectClick = () => {
    if (!window.confirm(DISCONNECT_CONFIRMATION)) return;

    startDisconnectTransition(async () => {
      try {
        const result = await disconnectAdAccount();
        if (result.error) {
          toast.error("Could not disconnect Meta Ads", { description: result.error });
          return;
        }
        toast.success("Meta Ads disconnected");
        // Drops any ?ads_step=select_account, which would otherwise keep the
        // account picker showing.
        router.replace("/connections");
        router.refresh();
      } catch (error) {
        const message = error instanceof Error ? error.message : "Something went wrong";
        toast.error("Could not disconnect Meta Ads", { description: message });
      }
    });
  };

  const disconnectButton = canDisconnect ? (
    <button
      type="button"
      onClick={handleDisconnectClick}
      disabled={isPendingDisconnect}
      className="shrink-0 rounded-full border px-4 py-2 text-sm font-semibold transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-60"
      style={{ borderColor: 'var(--c-claret)', color: 'var(--c-claret)', backgroundColor: 'var(--c-card)' }}
    >
      {isPendingDisconnect ? "Disconnecting…" : "Disconnect"}
    </button>
  ) : null;

  // Setup complete state
  if (initialStatus.setupComplete) {
    return (
      <div
        className="flex items-start justify-between gap-4 px-4 py-3"
        style={{
          borderRadius: 'var(--r-lg)',
          border: '1px solid var(--c-status-posted-bg)',
          backgroundColor: 'var(--c-status-posted-bg)',
        }}
      >
        <div className="space-y-0.5">
          <p className="text-sm font-semibold" style={{ color: 'var(--c-status-posted-fg)' }}>
            Meta Ads connected
          </p>
          <p className="text-xs" style={{ color: 'var(--c-status-posted-fg)' }}>
            Your ad account is selected and ready for campaign management.
          </p>
        </div>
        <div className="flex shrink-0 flex-col gap-2 sm:flex-row">
          {initialStatus.tokenExpiringSoon && (
            <button
              type="button"
              onClick={handleConnectClick}
              disabled={isPendingOAuth}
              className="shrink-0 rounded-full px-4 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60"
              style={{ backgroundColor: 'var(--c-orange)', color: 'white' }}
            >
              {isPendingOAuth ? "Redirecting…" : "Reconnect"}
            </button>
          )}
          {disconnectButton}
        </div>
      </div>
    );
  }

  // Connected but ad account not yet selected
  if (isConnected) {
    return (
      <div className="space-y-3">
        <p className="text-sm" style={{ color: 'var(--c-ink-3)' }}>
          Choose which ad account to use for campaigns:
        </p>

        {loadingAccounts && (
          <p className="text-sm" style={{ color: 'var(--c-ink-3)' }}>Loading ad accounts…</p>
        )}

        {accountsError && (
          <p className="text-sm" style={{ color: 'var(--c-claret)' }}>{accountsError}</p>
        )}

        {!loadingAccounts && !accountsError && accounts.length === 0 && (
          <p className="text-sm" style={{ color: 'var(--c-ink-3)' }}>
            No ad accounts found on this Meta connection.
          </p>
        )}

        {accounts.length > 0 && (
          <ul className="space-y-2">
            {accounts.map((account) => {
              const isSelectingThisAccount = selectingAccountId === account.id;

              return (
                <li
                  key={account.id}
                  className="flex items-center justify-between gap-4 px-4 py-3"
                  style={{
                    borderRadius: 'var(--r-lg)',
                    border: '1px solid var(--c-line)',
                    backgroundColor: 'var(--c-card)',
                    boxShadow: 'var(--sh-xs)',
                  }}
                >
                  <div className="space-y-0.5">
                    <p className="text-sm font-medium" style={{ color: 'var(--c-ink)' }}>{account.name}</p>
                    <p className="text-xs" style={{ color: 'var(--c-ink-3)' }}>
                      {account.currency} · {account.timezoneName}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleSelectAccount(account.id, account.name)}
                    disabled={isPendingSelect || Boolean(selectingAccountId)}
                    className="shrink-0 rounded-full px-4 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60"
                    style={{ backgroundColor: 'var(--c-orange)', color: 'white' }}
                  >
                    {isSelectingThisAccount ? "Selecting..." : "Select"}
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {disconnectButton}
      </div>
    );
  }

  // Not connected — show connect button
  return (
    <button
      type="button"
      onClick={handleConnectClick}
      disabled={isPendingOAuth}
      className="rounded-full px-4 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60"
      style={{ backgroundColor: 'var(--c-orange)', color: 'white' }}
    >
      {isPendingOAuth ? "Redirecting…" : "Connect Meta Ads"}
    </button>
  );
}
