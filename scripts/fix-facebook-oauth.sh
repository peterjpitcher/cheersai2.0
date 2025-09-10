#!/bin/bash

# Facebook App Configuration Fix Script
# This uses the Facebook Graph API to configure OAuth settings

APP_ID="1001401138674450"
APP_SECRET="089a1b973dab96f26e4cc6d053637d8a"

echo "Attempting to configure Facebook App OAuth settings via API..."
echo "Note: You'll need an App Access Token for this to work"

# Get App Access Token
ACCESS_TOKEN="${APP_ID}|${APP_SECRET}"

# Try to update app settings
echo "Updating app domains..."
curl -X POST "https://graph.facebook.com/v18.0/${APP_ID}" \
  -d "app_domains[]=www.cheersai.uk" \
  -d "website_url=https://www.cheersai.uk/" \
  -d "access_token=${ACCESS_TOKEN}"

echo ""
echo "NOTE: Valid OAuth Redirect URIs cannot be set via API"
echo "They must be set through the Facebook Developer Console"
echo ""
echo "Try these alternative URLs in your browser:"
echo "1. Direct link to Facebook Login settings:"
echo "   https://developers.facebook.com/apps/${APP_ID}/fb-login/settings/"
echo ""
echo "2. Direct link to Use Cases:"
echo "   https://developers.facebook.com/apps/${APP_ID}/use-cases/"
echo ""
echo "3. Old interface (might still work):"
echo "   https://developers.facebook.com/apps/${APP_ID}/settings/advanced/"
