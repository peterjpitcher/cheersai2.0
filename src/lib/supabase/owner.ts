import { OWNER_ACCOUNT_ID, OWNER_DISPLAY_NAME, OWNER_EMAIL, DEFAULT_TIMEZONE } from "@/lib/constants";
import { isSchemaMissingError } from "@/lib/supabase/errors";
import { tryCreateServiceSupabaseClient } from "@/lib/supabase/service";

const PROVIDERS: Array<"facebook" | "instagram" | "gbp"> = [
  "facebook",
  "instagram",
  "gbp",
];

type AccountRow = {
  id: string;
  email: string;
  display_name: string | null;
  timezone: string | null;
};

export async function ensureOwnerAccount() {
  const supabase = tryCreateServiceSupabaseClient();

  if (!supabase) {
    return;
  }

  try {
    const { data: account, error } = await supabase
      .from("accounts")
      .select("id")
      .eq("id", OWNER_ACCOUNT_ID)
      .maybeSingle();

    if (error) {
      if (isSchemaMissingError(error)) return;
      throw error;
    }

    if (!account) {
      const { error: insertError } = await supabase
        .from("accounts")
        .insert({
          id: OWNER_ACCOUNT_ID,
          email: OWNER_EMAIL,
          display_name: OWNER_DISPLAY_NAME,
          timezone: DEFAULT_TIMEZONE,
        });

      if (insertError) {
        if (isSchemaMissingError(insertError)) return;
        throw insertError;
      }
    }

    const { error: defaultsError } = await supabase
      .from("posting_defaults")
      .upsert(
        {
          account_id: OWNER_ACCOUNT_ID,
          gbp_cta_standard: "LEARN_MORE",
          gbp_cta_event: "LEARN_MORE",
          gbp_cta_offer: "REDEEM",
        },
        { onConflict: "account_id" },
      );

    if (defaultsError) {
      if (isSchemaMissingError(defaultsError)) return;
      throw defaultsError;
    }

    const { error: profileError } = await supabase
      .from("brand_profile")
      .upsert(
        {
          account_id: OWNER_ACCOUNT_ID,
        },
        { onConflict: "account_id" },
      );

    if (profileError) {
      if (isSchemaMissingError(profileError)) return;
      throw profileError;
    }

    const placeholderRows = PROVIDERS.map((provider) => ({
      account_id: OWNER_ACCOUNT_ID,
      provider,
    }));

    const { error: connectionsError } = await supabase
      .from("social_connections")
      .upsert(placeholderRows, { onConflict: "account_id,provider" });

    if (connectionsError) {
      if (isSchemaMissingError(connectionsError)) return;
      throw connectionsError;
    }
  } catch (error) {
    if (isSchemaMissingError(error)) {
      return;
    }
    throw error;
  }
}

export async function getOwnerAccount(): Promise<AccountRow> {
  const supabase = tryCreateServiceSupabaseClient();
  await ensureOwnerAccount();

  if (!supabase) {
    return fallbackAccount();
  }

  try {
    const { data, error } = await supabase
      .from("accounts")
      .select("id, email, display_name, timezone")
      .eq("id", OWNER_ACCOUNT_ID)
      .maybeSingle<AccountRow>();

    if (error) {
      if (isSchemaMissingError(error)) {
        return fallbackAccount();
      }
      throw error;
    }

    if (!data) {
      return fallbackAccount();
    }

    return data;
  } catch (error) {
    if (isSchemaMissingError(error)) {
      return fallbackAccount();
    }
    throw error;
  }
}

function fallbackAccount(): AccountRow {
  return {
    id: OWNER_ACCOUNT_ID,
    email: OWNER_EMAIL,
    display_name: OWNER_DISPLAY_NAME,
    timezone: DEFAULT_TIMEZONE,
  };
}
