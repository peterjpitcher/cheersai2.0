import { requireAuthContext } from "@/lib/auth/server";
import { createServiceSupabaseClient } from "@/lib/supabase/service";
import { isSchemaMissingError } from "@/lib/supabase/errors";

export const DEFAULT_MANAGEMENT_APP_BASE_URL = "https://management.orangejelly.co.uk";
export const MANAGEMENT_CONNECTION_SCHEMA_MISSING_MESSAGE =
  "Management app connection is unavailable because the database schema is missing. Run the latest Supabase migrations, then configure the connection in Settings.";

export interface ManagementConnectionSummary {
  baseUrl: string;
  enabled: boolean;
  configured: boolean;
  hasApiKey: boolean;
  lastTestedAt?: string;
  lastTestStatus?: "ok" | "error";
  lastTestMessage?: string;
}

export interface ManagementConnectionConfig {
  baseUrl: string;
  apiKey: string;
  enabled: boolean;
}

interface ManagementConnectionRow {
  account_id: string;
  base_url: string;
  api_key: string;
  enabled: boolean;
  last_tested_at: string | null;
  last_test_status: "ok" | "error" | null;
  last_test_message: string | null;
}

interface SaveConnectionInput {
  baseUrl: string;
  apiKey?: string;
  enabled: boolean;
}

interface UpdateConnectionTestResultInput {
  status: "ok" | "error";
  message: string;
}

export async function getManagementConnectionSummary(): Promise<ManagementConnectionSummary> {
  const { accountId } = await requireAuthContext();
  const supabase = createServiceSupabaseClient();

  const { data, error } = await supabase
    .from("management_app_connections")
    .select("account_id, base_url, api_key, enabled, last_tested_at, last_test_status, last_test_message")
    .eq("account_id", accountId)
    .maybeSingle<ManagementConnectionRow>();

  if (error) {
    if (isSchemaMissingError(error)) {
      return toSummary(null);
    }
    throw error;
  }

  return toSummary(data ?? null);
}

export async function getManagementConnectionConfig(): Promise<ManagementConnectionConfig> {
  const { accountId } = await requireAuthContext();
  const supabase = createServiceSupabaseClient();

  const { data, error } = await supabase
    .from("management_app_connections")
    .select("account_id, base_url, api_key, enabled, last_tested_at, last_test_status, last_test_message")
    .eq("account_id", accountId)
    .maybeSingle<ManagementConnectionRow>();

  if (error) {
    if (isSchemaMissingError(error)) {
      throw new Error(MANAGEMENT_CONNECTION_SCHEMA_MISSING_MESSAGE);
    }
    throw error;
  }

  const apiKey = data?.api_key?.trim();
  if (!data || !apiKey) {
    throw new Error("Management app connection is not configured.");
  }

  if (!data.enabled) {
    throw new Error("Management app connection is disabled.");
  }

  return {
    baseUrl: data.base_url,
    apiKey,
    enabled: data.enabled,
  } satisfies ManagementConnectionConfig;
}

export async function saveManagementConnection(input: SaveConnectionInput): Promise<ManagementConnectionSummary> {
  const { accountId } = await requireAuthContext();
  const supabase = createServiceSupabaseClient();

  const { data: existing, error: existingError } = await supabase
    .from("management_app_connections")
    .select("account_id, base_url, api_key, enabled, last_tested_at, last_test_status, last_test_message")
    .eq("account_id", accountId)
    .maybeSingle<ManagementConnectionRow>();

  if (existingError) {
    if (isSchemaMissingError(existingError)) {
      throw new Error(MANAGEMENT_CONNECTION_SCHEMA_MISSING_MESSAGE);
    }
    throw existingError;
  }

  const nextApiKey = input.apiKey?.trim() || existing?.api_key || "";
  if (!nextApiKey) {
    throw new Error("Provide an API key before saving the management app connection.");
  }

  const payload = {
    account_id: accountId,
    base_url: normalizeBaseUrl(input.baseUrl),
    api_key: nextApiKey,
    enabled: input.enabled,
    updated_at: new Date().toISOString(),
  };

  const { data: saved, error: saveError } = await supabase
    .from("management_app_connections")
    .upsert(payload, { onConflict: "account_id" })
    .select("account_id, base_url, api_key, enabled, last_tested_at, last_test_status, last_test_message")
    .single<ManagementConnectionRow>();

  if (saveError) {
    if (isSchemaMissingError(saveError)) {
      throw new Error(MANAGEMENT_CONNECTION_SCHEMA_MISSING_MESSAGE);
    }
    throw saveError;
  }

  return toSummary(saved);
}

export async function updateManagementConnectionTestResult(
  input: UpdateConnectionTestResultInput,
): Promise<ManagementConnectionSummary> {
  const { accountId } = await requireAuthContext();
  const supabase = createServiceSupabaseClient();

  const nowIso = new Date().toISOString();
  const payload = {
    last_tested_at: nowIso,
    last_test_status: input.status,
    last_test_message: input.message,
    updated_at: nowIso,
  };

  const { data, error } = await supabase
    .from("management_app_connections")
    .update(payload)
    .eq("account_id", accountId)
    .select("account_id, base_url, api_key, enabled, last_tested_at, last_test_status, last_test_message")
    .maybeSingle<ManagementConnectionRow>();

  if (error) {
    if (isSchemaMissingError(error)) {
      throw new Error(MANAGEMENT_CONNECTION_SCHEMA_MISSING_MESSAGE);
    }
    throw error;
  }

  if (!data) {
    throw new Error("Management app connection is not configured.");
  }

  return toSummary(data);
}

function toSummary(row: ManagementConnectionRow | null): ManagementConnectionSummary {
  const baseUrl = row?.base_url ?? DEFAULT_MANAGEMENT_APP_BASE_URL;
  const hasApiKey = Boolean(row?.api_key?.trim());

  return {
    baseUrl,
    enabled: row?.enabled ?? true,
    configured: Boolean(hasApiKey),
    hasApiKey,
    lastTestedAt: row?.last_tested_at ?? undefined,
    lastTestStatus: row?.last_test_status ?? undefined,
    lastTestMessage: row?.last_test_message ?? undefined,
  } satisfies ManagementConnectionSummary;
}

function normalizeBaseUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(trimmed)) {
    throw new Error("Base URL must start with http:// or https://.");
  }
  return trimmed;
}
