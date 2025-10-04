import { env } from "@/env";

const FACEBOOK_SCOPES = [
  "pages_show_list",
  "pages_read_engagement",
  "pages_manage_posts",
  "pages_manage_metadata",
  "instagram_basic",
  "instagram_content_publish",
  "instagram_manage_comments",
  "business_management",
].join(",");

const INSTAGRAM_SCOPES = [
  "instagram_basic",
  "instagram_content_publish",
  "instagram_manage_comments",
  "pages_show_list",
  "pages_read_engagement",
  "business_management",
].join(",");

const GBP_SCOPES = ["https://www.googleapis.com/auth/business.manage"].join(" ");

const SITE_URL = env.client.NEXT_PUBLIC_SITE_URL.replace(/\/$/, "");

export type Provider = "facebook" | "instagram" | "gbp";

export function buildOAuthRedirectUrl(provider: Provider, state: string) {
  switch (provider) {
    case "facebook":
      return buildFacebookOAuthUrl(state);
    case "instagram":
      return buildInstagramOAuthUrl(state);
    case "gbp":
      return buildGoogleOAuthUrl(state);
    default:
      throw new Error(`Unsupported provider ${provider}`);
  }
}

function buildFacebookOAuthUrl(state: string) {
  const redirectUri = `${SITE_URL}/api/oauth/facebook/callback`;
  const params = new URLSearchParams({
    client_id: env.client.NEXT_PUBLIC_FACEBOOK_APP_ID,
    redirect_uri: redirectUri,
    state,
    scope: FACEBOOK_SCOPES,
    response_type: "code",
  });
  return `https://www.facebook.com/v19.0/dialog/oauth?${params.toString()}`;
}

function buildInstagramOAuthUrl(state: string) {
  const redirectUri = `${SITE_URL}/api/oauth/instagram/callback`;
  const params = new URLSearchParams({
    client_id: env.client.NEXT_PUBLIC_FACEBOOK_APP_ID,
    redirect_uri: redirectUri,
    state,
    scope: INSTAGRAM_SCOPES,
    response_type: "code",
  });
  return `https://www.facebook.com/v19.0/dialog/oauth?${params.toString()}`;
}

function buildGoogleOAuthUrl(state: string) {
  const redirectUri = `${SITE_URL}/api/oauth/gbp/callback`;
  const params = new URLSearchParams({
    client_id: env.server.GOOGLE_MY_BUSINESS_CLIENT_ID,
    redirect_uri: redirectUri,
    state,
    scope: GBP_SCOPES,
    response_type: "code",
    access_type: "offline",
    include_granted_scopes: "true",
    prompt: "consent",
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}
