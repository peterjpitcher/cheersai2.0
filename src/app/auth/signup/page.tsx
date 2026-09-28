import { redirect } from "next/navigation";

import { getSelfServeSignupSwitch } from "@/lib/signup/switch";

/**
 * Legacy sign-up URL (SPEC-self-serve-signup §4.1). While the sign-up switch
 * is off or unreadable it goes to the login page, as before; once it is on,
 * to /signup. Both are temporary (307) so no browser caches either answer.
 */
export const dynamic = "force-dynamic";

export default async function LegacySignupRedirectPage() {
  const state = await getSelfServeSignupSwitch();
  redirect(state === "open" ? "/signup" : "/login");
}
