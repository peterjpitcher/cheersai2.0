# Environment Variable Update Required

## Action Required: Add to your `.env.local` file

Please add the following environment variable to your `.env.local` file:

```env
# Site URL Configuration (Add this line)
NEXT_PUBLIC_SITE_URL=https://cheersai.uk
```

## Why This Is Needed

The senior developer recommended standardizing on `NEXT_PUBLIC_SITE_URL` as the primary URL configuration. This ensures consistency across the application and follows Next.js best practices.

## Current Status

- Your app currently uses `NEXT_PUBLIC_APP_URL` in some places
- The `getBaseUrl()` utility function already checks for `NEXT_PUBLIC_SITE_URL` first
- Adding this variable will ensure all URL references are consistent

## After Adding

Once you've added this environment variable:
1. The application will use a single source of truth for the site URL
2. All auth redirects will be consistent
3. Email templates will reference the correct domain

## Note

You can keep `NEXT_PUBLIC_APP_URL` as a fallback - the system will prefer `NEXT_PUBLIC_SITE_URL` when available.