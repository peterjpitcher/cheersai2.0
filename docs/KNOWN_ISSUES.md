# Known Issues & Browser Warnings

This document tracks known issues and browser warnings that don't affect functionality but may appear in console logs.

## Stripe Third-Party Cookie Warnings

### Status: Expected Behavior (Won't Fix)

You may see console warnings like:
```
Partitioned cookie or storage access was provided to https://js.stripe.com/... 
because it is loaded in the third-party context and dynamic state partitioning is enabled.
```

### Explanation
- These warnings are **expected behavior** when using Stripe.js
- They don't affect payment functionality
- Chrome hasn't deprecated third-party cookies yet (as of 2025)
- Stripe is actively working with Google on long-term solutions

### Impact
- **None** - Payments work normally
- Warnings are informational only
- Stripe will handle any necessary updates before browser changes

### References
- [Stripe Support: Chrome third-party cookie warnings](https://support.stripe.com/questions/chrome-third-party-cookie-warnings-for-websites-using-stripe-js)
- GitHub Issue: #46

---

## Cloudflare Bot Management Cookie Warnings

### Status: Low Priority

You may see console warnings like:
```
Cookie "__cf_bm" has been rejected for invalid domain
```

### Explanation
- The `__cf_bm` cookie is Cloudflare's bot management system
- Warnings occur when cookies are set from a different domain than expected
- Usually happens with CDN-hosted images

### Impact
- **Minimal** - Bot protection may still work
- Only creates console warnings
- Doesn't affect core functionality

### Potential Solutions
1. Ensure Cloudflare domain configuration matches app domain
2. Review CDN setup for image hosting
3. Consider serving images from same domain

### References
- GitHub Issue: #47

---

## Font Preload Warnings (Fixed)

### Status: Resolved ✅

Previously showed warnings about preloaded fonts not being used within timeout.

### Solution Applied
- Added explicit `preload: true` and `display: 'swap'` to font configurations
- See commit fixing `app/layout.tsx`

### References
- GitHub Issue: #45

---

## Notes for Developers

1. **Console Warnings**: Not all console warnings indicate bugs. Many are informational about future browser changes.

2. **Third-Party Services**: Warnings from services like Stripe, Cloudflare, or analytics tools are often expected and handled by the service provider.

3. **Priority Levels**:
   - **Critical**: Breaks functionality (e.g., media upload failure)
   - **High**: Affects user experience
   - **Medium**: Visual issues or performance warnings
   - **Low**: Console warnings that don't affect functionality

4. **Before Creating Issues**: Check this document first to see if the warning is already known and expected.

---

Last Updated: January 2025