# ✅ PubHubAI Setup Checklist

## Prerequisites
- [ ] Supabase account created
- [ ] Project created in Supabase
- [ ] Node.js installed locally

## 1. Database Setup (5 minutes)
- [ ] Open Supabase Dashboard → SQL Editor
- [ ] Copy entire script from `DATABASE_SETUP.md`
- [ ] Paste and run in SQL Editor
- [ ] Verify all tables created (should see 10 tables)

## 2. Storage Setup (2 minutes)
- [ ] Go to Storage in Supabase Dashboard
- [ ] Create new bucket called "media"
- [ ] Make it public for viewing

## 3. Environment Variables (2 minutes)
- [ ] Go to Settings → API in Supabase
- [ ] Copy to `.env.local`:
  ```
  NEXT_PUBLIC_SUPABASE_URL=[Your Project URL]
  NEXT_PUBLIC_SUPABASE_ANON_KEY=[Your Anon Key]
  SUPABASE_SERVICE_ROLE_KEY=[Your Service Role Key]
  ```
- [ ] Keep existing OpenAI and Stripe keys

## 4. Authentication Setup (3 minutes)
- [ ] Go to Authentication → URL Configuration
- [ ] Set Site URL: `http://localhost:3000`
- [ ] Add Redirect URLs:
  - `http://localhost:3000/auth/callback`
  - `http://localhost:3001/auth/callback`
  - `http://localhost:3002/auth/callback`
  - `http://localhost:3003/auth/callback`

## 5. Test the Setup (5 minutes)
- [ ] Run `npm run dev`
- [ ] Go to http://localhost:3000
- [ ] Click "Start Free Trial"
- [ ] Sign up with your email
- [ ] Check email and confirm
- [ ] Complete onboarding (3 steps)
- [ ] Should arrive at dashboard

## 6. Optional: Facebook Integration
- [ ] Create app at developers.facebook.com
- [ ] Add Facebook App ID to `.env.local`
- [ ] Add Facebook App Secret to `.env.local`
- [ ] Test social connection in Settings

## Troubleshooting

### Can't sign up?
- Check Supabase Dashboard → Authentication → Users
- Ensure email confirmations are enabled

### Database errors?
- Check all tables exist: SQL Editor → Run:
  ```sql
  SELECT COUNT(*) as table_count 
  FROM information_schema.tables 
  WHERE table_schema = 'public';
  ```
  Should return 10+ tables

### Can't upload images?
- Ensure "media" bucket exists in Storage
- Check it's set to public

### Onboarding fails?
- Check browser console for errors
- Ensure RLS policies are enabled
- Try the reset script in `ONBOARDING_TROUBLESHOOTING.md`

## Success Indicators
✅ Can sign up and receive email
✅ Can complete onboarding
✅ Can create a campaign
✅ Can generate AI content
✅ Can upload images
✅ Dashboard shows usage stats

## Time Estimate
**Total setup time: ~15 minutes**

## Next Steps
1. Create your first campaign
2. Test AI content generation
3. Connect a social account (if Facebook app configured)
4. Explore all features!

## Support Files
- `DATABASE_SETUP.md` - Complete SQL script
- `SUPABASE_SETUP.md` - Detailed auth configuration
- `ONBOARDING_TROUBLESHOOTING.md` - Fix common issues
- `URL_FORMATS_SUPPORTED.md` - Website analysis feature
- `TRIAL_STRATEGY.md` - Business model explanation