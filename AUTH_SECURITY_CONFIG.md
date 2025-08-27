# Auth Security Configuration for CheersAI

## Auth Warnings from Supabase Linter

The Supabase security linter has identified two authentication configuration warnings that should be addressed:

### 1. Leaked Password Protection Disabled (WARN)
**Issue**: Leaked password protection is currently disabled.
**Impact**: Users may be able to use compromised passwords that have been exposed in data breaches.

**How to Enable**:
1. Go to your Supabase Dashboard
2. Navigate to Authentication > Settings
3. Under "Security" section, find "Leaked Password Protection"
4. Toggle ON "Check passwords against HaveIBeenPwned"
5. Save changes

This will prevent users from using passwords that have been found in known data breaches, significantly improving account security.

### 2. Insufficient MFA Options (WARN)
**Issue**: Too few multi-factor authentication (MFA) options are enabled.
**Impact**: Users have limited options for securing their accounts with MFA, potentially reducing overall security.

**How to Enable More MFA Options**:
1. Go to your Supabase Dashboard
2. Navigate to Authentication > Settings
3. Under "Multi-Factor Authentication" section:
   - Enable TOTP (Time-based One-Time Passwords) - for apps like Google Authenticator
   - Enable SMS (if not already enabled) - for text message codes
   - Consider enabling WebAuthn for biometric/hardware key support
4. Save changes

**Recommended MFA Configuration**:
- ✅ TOTP (Authenticator Apps) - Most secure and widely compatible
- ✅ SMS - Good fallback option for users without authenticator apps
- ✅ WebAuthn (Optional) - For advanced security with hardware keys

## Implementation Notes

These are configuration changes that need to be made in the Supabase Dashboard, not through SQL migrations. They affect the authentication service configuration at the project level.

### For UK Compliance (GDPR/UK GDPR)
- Leaked password protection helps meet data protection requirements by preventing use of known compromised credentials
- MFA options provide stronger identity verification, reducing risk of unauthorized access to personal data

### User Communication
When enabling these features, consider:
1. Notifying users about enhanced security measures
2. Providing guides for setting up MFA
3. Having a support process for users who may have issues with MFA setup

## Status
- [ ] Enable Leaked Password Protection in Supabase Dashboard
- [ ] Enable TOTP MFA option
- [ ] Enable SMS MFA option
- [ ] Consider enabling WebAuthn
- [ ] Update user documentation about MFA
- [ ] Test MFA flow with different options

These configurations will significantly improve the security posture of CheersAI's authentication system.