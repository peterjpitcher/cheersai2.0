import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";

import { DEFAULT_TIMEZONE } from "@/lib/constants";

interface Arguments {
  email?: string;
  account?: string;
  "display-name"?: string;
  "account-email"?: string;
}

function parseArguments(argv: string[]): Arguments {
  const args: Arguments = {};
  for (let index = 2; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      continue;
    }
    const key = token.slice(2) as keyof Arguments;
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      (args as Record<string, string | undefined>)[key] = undefined;
      continue;
    }
    (args as Record<string, string | undefined>)[key] = next;
    index += 1;
  }
  return args;
}

function assertDefined<T>(value: T | undefined, message: string): T {
  if (value === undefined || value === null || value === "") {
    throw new Error(message);
  }
  return value;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

async function main() {
  try {
    const args = parseArguments(process.argv);

    const email = assertDefined(args.email, "--email is required (Supabase auth user email)").trim();
    const accountId = assertDefined(args.account, "--account is required (UUID of application account)").trim();

    if (!isUuid(accountId)) {
      throw new Error("--account must be a valid UUID");
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceKey) {
      throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in the environment");
    }

    const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

    const user = await findAuthUserByEmail(supabase, email);
    if (!user) {
      throw new Error(`Auth user with email ${email} was not found.`);
    }

    const nextMetadata = {
      ...(user.user_metadata ?? {}),
      account_id: accountId,
    } as Record<string, unknown>;

    if (typeof nextMetadata.account_id !== "string") {
      nextMetadata.account_id = accountId;
    }

    const { error: updateError } = await supabase.auth.admin.updateUserById(user.id, {
      user_metadata: nextMetadata,
    });
    if (updateError) {
      throw updateError;
    }

    const accountEmail = args["account-email"] ?? user.email ?? `${accountId}@placeholder.local`;
    const displayName = args["display-name"] ?? user.user_metadata?.display_name ?? deriveDisplayName(accountEmail);

    const { data: accountRow, error: accountFetchError } = await supabase
      .from("accounts")
      .select("id")
      .eq("id", accountId)
      .maybeSingle();

    if (accountFetchError) {
      throw accountFetchError;
    }

    if (!accountRow) {
      const { error: accountInsertError } = await supabase
        .from("accounts")
        .insert({
          id: accountId,
          email: accountEmail,
          display_name: displayName,
          timezone: DEFAULT_TIMEZONE,
        })
        .select("id")
        .single();

      if (accountInsertError) {
        throw accountInsertError;
      }
    }

    // Ensure posting defaults exist so first login succeeds without additional provisioning.
    const { error: defaultsError } = await supabase
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

    if (defaultsError) {
      throw defaultsError;
    }

    console.info(`Linked auth user ${email} to account ${accountId}.`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}

async function findAuthUserByEmail(client: SupabaseClient, email: string): Promise<User | null> {
  const normalisedEmail = email.toLowerCase();
  const perPage = 200;
  const maxPages = 25;

  for (let page = 1; page <= maxPages; page += 1) {
    const { data, error } = await client.auth.admin.listUsers({ page, perPage });
    if (error) {
      throw error;
    }

    const users = data?.users ?? [];
    const match = users.find((candidate) => candidate.email?.toLowerCase() === normalisedEmail);
    if (match) {
      return match;
    }

    if (users.length < perPage) {
      return null;
    }
  }

  return null;
}

function deriveDisplayName(email: string | null | undefined): string {
  if (!email) return "Member";
  const [local] = email.split("@");
  if (!local) return "Member";
  return local.charAt(0).toUpperCase() + local.slice(1);
}

void main();
