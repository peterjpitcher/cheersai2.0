import { createClient } from "@supabase/supabase-js";

/**
 * One-time super-admin bootstrap for multi-brand tenancy. Idempotent.
 *
 * Seeds public.app_admins by an EXPLICIT auth.users.id (never by email — an
 * email lookup can silently match zero rows and leave the system with no
 * administrator). Asserts the target user exists and verifies the row after
 * writing.
 *
 *   npm run ops:bootstrap-super-admin -- --user <auth-user-uuid>
 *
 * Requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the env.
 */

interface Arguments {
  user?: string;
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

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

async function main(): Promise<void> {
  const args = parseArguments(process.argv);
  const userId = (args.user ?? "").trim();

  if (!isUuid(userId)) {
    throw new Error("--user is required and must be a valid auth.users UUID");
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in the environment");
  }

  const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  // Assert the target auth user exists — fail loudly rather than seed a phantom admin.
  const { data: found, error: getError } = await supabase.auth.admin.getUserById(userId);
  if (getError || !found?.user) {
    throw new Error(`No auth user with id ${userId}: ${getError?.message ?? "not found"}`);
  }

  const { error: upsertError } = await supabase
    .from("app_admins")
    .upsert({ user_id: userId, created_by: userId }, { onConflict: "user_id" });
  if (upsertError) {
    throw new Error(`Failed to seed app_admins: ${upsertError.message}`);
  }

  // Post-write verification: the row must be present.
  const { data: check, error: checkError } = await supabase
    .from("app_admins")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (checkError || !check) {
    throw new Error(`Post-write verification failed: app_admins row for ${userId} not present`);
  }

  console.log(`Super-admin bootstrapped for ${userId} (${found.user.email ?? "no email"})`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
