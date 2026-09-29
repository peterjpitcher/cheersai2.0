/**
 * Meta access tokens (user, Page and system user) start with "EAA". Graph
 * error text can echo one back, and that text is logged and sometimes put in
 * a redirect address, so every Graph error message passes through here first.
 */
const META_ACCESS_TOKEN = /EAA[0-9A-Za-z_-]{10,}/g;

export function redactMetaAccessTokens(text: string): string {
  return text.replace(META_ACCESS_TOKEN, "[redacted token]");
}
