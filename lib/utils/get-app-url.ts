/**
 * Get the application URL for redirects and callbacks
 * Ensures we always use the production URL when not in local development
 */
export function getAppUrl(): string {
  // If NEXT_PUBLIC_APP_URL is set, use it
  if (process.env.NEXT_PUBLIC_APP_URL) {
    return process.env.NEXT_PUBLIC_APP_URL;
  }
  
  // In browser context
  if (typeof window !== 'undefined') {
    // If we're on localhost, always use production URL for auth redirects
    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
      return 'https://cheersai.orangejelly.co.uk';
    }
    // Otherwise use the current origin
    return window.location.origin;
  }
  
  // Server-side fallback
  return 'https://cheersai.orangejelly.co.uk';
}