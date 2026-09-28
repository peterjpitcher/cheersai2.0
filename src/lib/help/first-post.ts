import { getSelfServeSignupSwitch } from '@/lib/signup/switch';

/**
 * The first-post help article (tasks/SPEC-self-serve-signup.md, decision P10:
 * built with the admin Sign-ups card). Like everything customer-facing from
 * the sign-up work, it stays hidden until the self_serve_signup switch is
 * open: while the switch is off or cannot be read, the page is not found and
 * nothing links to it.
 */
export const FIRST_POST_HELP_PATH = '/help/first-post';

/** The article's link for the current request, or null while it is hidden. */
export async function getFirstPostHelpHref(): Promise<string | null> {
  return (await getSelfServeSignupSwitch()) === 'open' ? FIRST_POST_HELP_PATH : null;
}
