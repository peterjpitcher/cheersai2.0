# Supabase Email Template Configuration

**IMPORTANT**: These templates must be configured in the Supabase Dashboard under Authentication → Email Templates

## Prerequisites

1. **Site URL Configuration**:
   - Go to Authentication → URL Configuration
   - Set Site URL to: `https://cheersai.uk`

2. **Redirect URLs** (add all):
   - `https://cheersai.uk/auth/confirm`
   - `https://cheersai.uk/auth/callback`
   - `https://cheersai.uk/auth/reset-password`

3. **Enable Email Confirmation**:
   - Go to Authentication → Providers → Email
   - Enable "Confirm email"

## Email Templates

### 1. Confirm Signup (Email Verification)

**Subject**: `Confirm your CheersAI account`

**Body**:
```html
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { text-align: center; margin-bottom: 30px; }
    .logo { max-width: 150px; height: auto; }
    .button { display: inline-block; padding: 12px 24px; background-color: #EA580C; color: white; text-decoration: none; border-radius: 5px; margin: 20px 0; }
    .footer { margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e5e5; text-align: center; font-size: 12px; color: #666; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <img src="https://cheersai.uk/logo.png" alt="CheersAI" class="logo">
    </div>
    
    <h2>Welcome to CheersAI! 🍻</h2>
    
    <p>Thanks for signing up! Please confirm your email address by clicking the button below:</p>
    
    <div style="text-align: center;">
      <a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email" class="button">
        Confirm Email Address
      </a>
    </div>
    
    <p>Or copy and paste this link into your browser:</p>
    <p style="word-break: break-all; font-size: 12px; color: #666;">
      {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email
    </p>
    
    <p>This link will expire in 24 hours.</p>
    
    <div class="footer">
      <p>© 2024 CheersAI by Orange Jelly Limited. All rights reserved.</p>
      <p>If you didn't create an account, you can safely ignore this email.</p>
    </div>
  </div>
</body>
</html>
```

### 2. Magic Link

**Subject**: `Your CheersAI login link`

**Body**:
```html
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { text-align: center; margin-bottom: 30px; }
    .logo { max-width: 150px; height: auto; }
    .button { display: inline-block; padding: 12px 24px; background-color: #EA580C; color: white; text-decoration: none; border-radius: 5px; margin: 20px 0; }
    .footer { margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e5e5; text-align: center; font-size: 12px; color: #666; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <img src="https://cheersai.uk/logo.png" alt="CheersAI" class="logo">
    </div>
    
    <h2>Your login link is ready! 🔐</h2>
    
    <p>Click the button below to log in to your CheersAI account:</p>
    
    <div style="text-align: center;">
      <a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=magiclink" class="button">
        Log In to CheersAI
      </a>
    </div>
    
    <p>Or copy and paste this link into your browser:</p>
    <p style="word-break: break-all; font-size: 12px; color: #666;">
      {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=magiclink
    </p>
    
    <p>This link will expire in 1 hour.</p>
    
    <div class="footer">
      <p>© 2024 CheersAI by Orange Jelly Limited. All rights reserved.</p>
      <p>If you didn't request this login link, you can safely ignore this email.</p>
    </div>
  </div>
</body>
</html>
```

### 3. Reset Password

**Subject**: `Reset your CheersAI password`

**Body**:
```html
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { text-align: center; margin-bottom: 30px; }
    .logo { max-width: 150px; height: auto; }
    .button { display: inline-block; padding: 12px 24px; background-color: #EA580C; color: white; text-decoration: none; border-radius: 5px; margin: 20px 0; }
    .footer { margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e5e5; text-align: center; font-size: 12px; color: #666; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <img src="https://cheersai.uk/logo.png" alt="CheersAI" class="logo">
    </div>
    
    <h2>Reset your password 🔑</h2>
    
    <p>We received a request to reset your password. Click the button below to create a new password:</p>
    
    <div style="text-align: center;">
      <a href="{{ .SiteURL }}/auth/reset-password?token_hash={{ .TokenHash }}&type=recovery" class="button">
        Reset Password
      </a>
    </div>
    
    <p>Or copy and paste this link into your browser:</p>
    <p style="word-break: break-all; font-size: 12px; color: #666;">
      {{ .SiteURL }}/auth/reset-password?token_hash={{ .TokenHash }}&type=recovery
    </p>
    
    <p>This link will expire in 1 hour.</p>
    
    <div class="footer">
      <p>© 2024 CheersAI by Orange Jelly Limited. All rights reserved.</p>
      <p>If you didn't request a password reset, you can safely ignore this email.</p>
    </div>
  </div>
</body>
</html>
```

### 4. Invitation (Team Member Invite)

**Subject**: `You've been invited to join {{ .TeamName }} on CheersAI`

**Body**:
```html
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { text-align: center; margin-bottom: 30px; }
    .logo { max-width: 150px; height: auto; }
    .button { display: inline-block; padding: 12px 24px; background-color: #EA580C; color: white; text-decoration: none; border-radius: 5px; margin: 20px 0; }
    .footer { margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e5e5; text-align: center; font-size: 12px; color: #666; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <img src="https://cheersai.uk/logo.png" alt="CheersAI" class="logo">
    </div>
    
    <h2>You're invited! 🎉</h2>
    
    <p>You've been invited to join the team at <strong>{{ .TeamName }}</strong> on CheersAI.</p>
    
    <p>CheersAI helps UK pubs and hospitality businesses create engaging social media content with AI.</p>
    
    <div style="text-align: center;">
      <a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite" class="button">
        Accept Invitation
      </a>
    </div>
    
    <p>Or copy and paste this link into your browser:</p>
    <p style="word-break: break-all; font-size: 12px; color: #666;">
      {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite
    </p>
    
    <p>This invitation will expire in 7 days.</p>
    
    <div class="footer">
      <p>© 2024 CheersAI by Orange Jelly Limited. All rights reserved.</p>
    </div>
  </div>
</body>
</html>
```

## Important Notes

1. **Token Hash Flow**: All templates now use `token_hash` parameter instead of PKCE `code` parameter
2. **Type Parameter**: Each template includes a `type` parameter to help the confirm route identify the flow
3. **Logo URL**: Ensure `logo.png` is accessible at `https://cheersai.uk/logo.png`
4. **Testing**: After updating templates, test each flow:
   - New user signup
   - Magic link login
   - Password reset
   - Team invitations (if applicable)

## Verification Steps

1. Go to Supabase Dashboard → Authentication → Email Templates
2. Update each template with the HTML above
3. Save changes
4. Test each flow in staging environment first
5. Monitor `/auth/confirm` route logs for any issues

## Troubleshooting

If emails are not being delivered:
1. Check Supabase Dashboard → Authentication → Settings → SMTP Settings
2. Verify Resend API key is configured correctly
3. Check email logs in Supabase Dashboard → Logs → Auth Logs
4. Ensure user's email address is valid and not bouncing

If confirmation links are not working:
1. Verify Site URL is set correctly in Supabase
2. Check that `/auth/confirm` route is accessible
3. Verify token_hash parameter is being passed correctly
4. Check browser console for any JavaScript errors