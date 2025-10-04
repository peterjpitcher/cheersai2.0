import { DEFAULT_TIMEZONE } from "@/lib/constants";
import { getOwnerAccount } from "@/lib/supabase/owner";

export interface AppUser {
  id: string;
  email: string;
  displayName: string;
  timezone: string;
}

export async function getCurrentUser(): Promise<AppUser> {
  const account = await getOwnerAccount();

  return {
    id: account.id,
    email: account.email,
    displayName: account.display_name ?? "Owner",
    timezone: account.timezone ?? DEFAULT_TIMEZONE,
  };
}
