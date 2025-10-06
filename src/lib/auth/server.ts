import { redirect } from "next/navigation";

import type { AppUser } from "@/lib/auth/types";
import { DEFAULT_TIMEZONE } from "@/lib/constants";
import { isSchemaMissingError } from "@/lib/supabase/errors";
import { tryCreateServiceSupabaseClient } from "@/lib/supabase/service";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export async function requireAuthContext() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError) {
    throw authError;
  }

  if (!user) {
    redirect("/login");
  }

  const accountId = resolveAccountId(user);
  await ensureAccountRecord(accountId, user.email ?? null);

  return { supabase, user, accountId } as const;
}

export async function getCurrentUser(): Promise<AppUser> {
  const { supabase, user, accountId } = await requireAuthContext();

  const { data: account, error: accountError } = await supabase
    .from("accounts")
    .select("id, email, display_name, timezone")
    .eq("id", accountId)
    .maybeSingle<{ id: string; email: string; display_name: string | null; timezone: string | null }>();

  if (accountError) {
    throw accountError;
  }

  if (!account) {
    const fallback = await fetchAccountViaService(accountId);
    return shapeUserFromAccount(user.email ?? fallback.email, fallback);
  }

  return shapeUserFromAccount(user.email ?? account.email, account);
}

function resolveAccountId(user: { id: string; user_metadata?: Record<string, unknown> }): string {
  const metadataAccountId = user.user_metadata?.account_id;
  if (typeof metadataAccountId === "string" && metadataAccountId.length) {
    return metadataAccountId;
  }

  throw new Error(
    "Authenticated user is missing `user_metadata.account_id`. Set this metadata in Supabase Auth to map the user to an application account.",
  );
}

async function ensureAccountRecord(accountId: string, email: string | null) {
  const service = tryCreateServiceSupabaseClient();

  if (!service) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is required to bootstrap account records after authentication.");
  }

  const { data, error } = await service
    .from("accounts")
    .select("id")
    .eq("id", accountId)
    .maybeSingle<{ id: string }>();

  if (error && !isSchemaMissingError(error)) {
    throw error;
  }

  if (data) {
    return;
  }

  const displayName = email ? deriveDisplayName(email) : "Member";
  const emailToStore = email ?? `${accountId}@placeholder.local`;

  const { error: insertError } = await service
    .from("accounts")
    .insert({
      id: accountId,
      email: emailToStore,
      display_name: displayName,
      timezone: DEFAULT_TIMEZONE,
    })
    .select("id")
    .single();

  if (insertError && !isSchemaMissingError(insertError)) {
    throw insertError;
  }

  await ensurePostingDefaults(service, accountId);
}

async function fetchAccountViaService(accountId: string) {
  const service = tryCreateServiceSupabaseClient();
  if (!service) {
    throw new Error("Supabase service role is not configured.");
  }

  const { data, error } = await service
    .from("accounts")
    .select("id, email, display_name, timezone")
    .eq("id", accountId)
    .maybeSingle<{ id: string; email: string; display_name: string | null; timezone: string | null }>();

  if (error) {
    throw error;
  }

  if (!data) {
    throw new Error(`Account ${accountId} could not be found.`);
  }

  return data;
}

async function ensurePostingDefaults(service: ReturnType<typeof tryCreateServiceSupabaseClient>, accountId: string) {
  if (!service) return;

  const { error } = await service
    .from("posting_defaults")
    .upsert(
      {
        account_id: accountId,
        notifications: {
          emailFailures: true,
          emailTokenExpiring: true,
        },
        gbp_cta_standard: "LEARN_MORE",
        gbp_cta_event: "LEARN_MORE",
        gbp_cta_offer: "REDEEM",
      },
      { onConflict: "account_id" },
    );

  if (error && !isSchemaMissingError(error)) {
    throw error;
  }
}

function shapeUserFromAccount(emailFallback: string, account: {
  id: string;
  email: string;
  display_name: string | null;
  timezone: string | null;
}): AppUser {
  return {
    id: account.id,
    email: account.email || emailFallback,
    displayName: account.display_name ?? deriveDisplayName(emailFallback),
    timezone: account.timezone ?? DEFAULT_TIMEZONE,
  };
}

function deriveDisplayName(email: string): string {
  if (!email) {
    return "Member";
  }
  const [name] = email.split("@");
  return name ? capitalize(name) : "Member";
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
