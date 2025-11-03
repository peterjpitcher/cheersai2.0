import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import type { SupabaseClient } from "@supabase/supabase-js";

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
    if (isAuthSessionMissingError(authError)) {
      await clearSupabaseSessionCookies();
      try {
        await supabase.auth.signOut();
      } catch {
        // ignore sign-out failures when the session is already invalid
      }
      redirect("/login");
    }
    throw authError;
  }

  if (!user) {
    redirect("/login");
  }

  const accountId = resolveAccountId(user);
  await ensureAccountRecord(accountId, user.email ?? null, supabase);

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

function readAccountId(metadata: Record<string, unknown> | undefined): string | null {
  if (!metadata) {
    return null;
  }

  const candidate = metadata["account_id"] ?? metadata["accountId"];
  if (typeof candidate === "string") {
    const trimmed = candidate.trim();
    if (trimmed.length > 0) {
      return trimmed;
    }
  }

  return null;
}

export function resolveAccountId(user: {
  id: string;
  user_metadata?: Record<string, unknown>;
  app_metadata?: Record<string, unknown>;
}): string {
  const metadataAccountId = readAccountId(user.user_metadata);
  if (metadataAccountId) {
    return metadataAccountId;
  }

  const appMetadataAccountId = readAccountId(user.app_metadata);
  if (appMetadataAccountId) {
    return appMetadataAccountId;
  }

  return user.id;
}

async function ensureAccountRecord(accountId: string, email: string | null, supabase: SupabaseClient) {
  const displayName = email ? deriveDisplayName(email) : "Member";
  const emailToStore = email ?? `${accountId}@placeholder.local`;

  const desired = {
    id: accountId,
    email: emailToStore,
    display_name: displayName,
    timezone: DEFAULT_TIMEZONE,
  } as const;

  const sessionResult = await upsertAccountWithClient(supabase, desired);
  if (sessionResult === "ok" || sessionResult === "schema-missing") {
    if (sessionResult === "ok") {
      await ensurePostingDefaults(supabase, accountId);
    }
    return;
  }

  const service = tryCreateServiceSupabaseClient();
  if (!service) {
    throw new Error(
      "Unable to provision account record. Either configure SUPABASE_SERVICE_ROLE_KEY or allow account inserts for authenticated users.",
    );
  }

  const serviceResult = await upsertAccountWithClient(service, desired);
  if (serviceResult === "ok") {
    await ensurePostingDefaults(service, accountId);
    return;
  }

  if (serviceResult === "schema-missing") {
    return;
  }

  throw new Error("Failed to provision account record for authenticated user.");
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

async function ensurePostingDefaults(client: SupabaseClient, accountId: string) {
  const { error } = await client
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

  if (error && !isSchemaMissingError(error) && !isPermissionDeniedError(error)) {
    throw error;
  }
}

type AccountInsert = {
  id: string;
  email: string;
  display_name: string;
  timezone: string;
};

type UpsertOutcome = "ok" | "schema-missing" | "permission-denied";

async function upsertAccountWithClient(client: SupabaseClient, account: AccountInsert): Promise<UpsertOutcome> {
  const { data, error } = await client
    .from("accounts")
    .select("id")
    .eq("id", account.id)
    .maybeSingle<{ id: string }>();

  if (error) {
    if (isSchemaMissingError(error)) {
      return "schema-missing";
    }
    throw error;
  }

  if (data) {
    return "ok";
  }

  const { error: insertError } = await client
    .from("accounts")
    .insert(account)
    .select("id")
    .single();

  if (insertError) {
    if (isSchemaMissingError(insertError)) {
      return "schema-missing";
    }
    if (isPermissionDeniedError(insertError)) {
      return "permission-denied";
    }
    throw insertError;
  }

  return "ok";
}

function isPermissionDeniedError(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  if (error.code === "42501") {
    return true;
  }
  const message = error.message ?? "";
  return /permission denied/i.test(message) || /row-level security/i.test(message);
}

function isAuthSessionMissingError(
  error: { name?: string; status?: number; message?: string; code?: string } | null | undefined,
): boolean {
  if (!error) return false;
  if (error.name === "AuthSessionMissingError") {
    return true;
  }
  if (error.code === "refresh_token_not_found") {
    return true;
  }
  const message = (error.message ?? "").toLowerCase();
  if (error.status === 400 && message.includes("session missing")) {
    return true;
  }
  if (message.includes("invalid refresh token") || message.includes("refresh token not found")) {
    return true;
  }
  return false;
}

async function clearSupabaseSessionCookies() {
  const store = (await cookies()) as unknown as {
    getAll: () => Array<{ name: string; value: string }>;
    delete: (name: string) => void;
  };

  try {
    store
      .getAll()
      .filter(({ name }) => name.startsWith("sb-"))
      .forEach(({ name }) => {
        try {
          store.delete(name);
        } catch {
          // unable to delete cookies in read-only contexts, ignore
        }
      });
  } catch {
    // ignore failures reading or deleting cookies
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
