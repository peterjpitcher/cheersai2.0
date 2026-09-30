# Runbook: Meta App Review for organic publishing

**Last updated:** 2026-09-28
**Applies to:** the CheersAI Meta app (`1001401138674450`, business portfolio Orange Jelly `1042710779156582`)
**Decision:** spec `tasks/SPEC-new-customer-readiness.md` D7 and finding M1.

## 1. Why this is needed

Checked on the App Dashboard on 26 September 2026:

| Check | Result |
|---|---|
| App mode | Live since 15 August 2025 |
| Business Verification | Verified for ORANGE JELLY LIMITED, 16 August 2025 |
| Access level of every permission | Standard access only; none has Advanced access |
| App Review history | One submission, 17 October 2025, for `instagram_business_basic`, `instagram_business_content_publish` and `instagram_business_manage_insights` (the Instagram-login path, which CheersAI does not use). Not approved. |
| App roles | Peter Pitcher and Billy Summers (administrators), `theanchor.pub` (Instagram tester), no testers |

Meta only lets people with a role on the app grant a Standard access permission. The Anchor works
because Peter connects it as an administrator. A new venue's staff cannot connect Facebook or
Instagram until the permissions below have Advanced access, which needs App Review.

**Until approval:** a venue's staff can connect only if Peter adds them as testers on the app in
Meta Business Suite (up to 500) and they accept the invite.

## 2. What to request

First submission: the organic publishing permissions only. Paid ads are not offered to new
customers (spec D1b); `ads_management` and `ads_read` need the Tech Provider route with access
verification and are a later, separate submission.

| Permission | What CheersAI does with it | Graph calls |
|---|---|---|
| `pages_show_list` | Lists the Pages the person manages when they connect, so CheersAI can link the venue's Page | `GET /me/accounts` |
| `pages_read_engagement` | Reads the Page name, the Page access token and the linked Instagram account at connect time; Meta requires it for publishing to a Page and to Instagram | `GET /me/accounts?fields=id,name,access_token,instagram_business_account{id,username,name}` |
| `pages_manage_posts` | Publishes the venue's approved posts and stories to its Facebook Page | `POST /{page-id}/feed`, `/{page-id}/photos`, `/{page-id}/photo_stories` |
| `instagram_basic` | Reads the linked Instagram professional account's id and username, shown on the Connections page, and checks the publishing limit after an unclear failure | `GET /{ig-id}?fields=id,username`, `GET /{ig-id}/content_publishing_limit` |
| `instagram_content_publish` | Publishes the venue's approved feed posts and stories to Instagram | `POST /{ig-id}/media`, `POST /{ig-id}/media_publish` |
| `business_management` | Many venues hold their Page in a Meta business portfolio; this lets `/me/accounts` return those Pages when the owner connects. CheersAI makes no other Business Manager API call | none of its own |

These match `FACEBOOK_SCOPE_LIST` and `INSTAGRAM_SCOPE_LIST` in `src/lib/connections/oauth.ts`.
`pages_manage_metadata` and `instagram_manage_comments` were removed on 26 September 2026 because
nothing uses them, and Meta rejects permissions an app does not use.

Meta's requirements (checked 26 September 2026): Page posts and stories need `pages_show_list`,
`pages_read_engagement` and `pages_manage_posts`; Instagram publishing with Facebook Login needs
`instagram_basic`, `instagram_content_publish` and `pages_read_engagement`.

**Known risks**

- `business_management` is the one most likely to be questioned, because CheersAI calls no
  business endpoint. The recording must show connecting a Page that sits in a business portfolio.
  If Meta rejects it, resubmit without it after testing whether a portfolio Page still appears.
- Meta's Instagram publishing docs say that when a person's Page role comes through a business
  portfolio, the app "will also need" `ads_management` or `ads_read`. The Anchor has those grants
  from its ads connection, so this has never been tested without them. Test it with the first
  non-tester venue (section 7). If Instagram publishing fails for them, `ads_read` joins the ads
  submission.

## 3. Before submitting

| Item | Status on 26 September 2026 | Owner |
|---|---|---|
| Privacy policy at `https://cheers.orangejelly.co.uk/privacy` | Live since 27 September 2026 (#131) with the correct company details, London hosting and a Facebook and Instagram section including deletion steps. Set as the app's privacy policy URL | done |
| Terms at `https://cheers.orangejelly.co.uk/terms` | Set; rewritten with the privacy policy on the same branch | Claude |
| Data deletion callback `https://cheers.orangejelly.co.uk/api/social/delete-data` | Set, live; a forged request returns 400 | done |
| Deauthorise callback | Set by Peter, 26 September 2026 | done |
| App icon, category, contact email (`peter@orangejelly.co.uk`), app domain | Set | done |
| Business Verification | Verified | done |
| A test Facebook Page linked to a test Instagram professional account | Page **Cheers Test Venue** made 29 September 2026 (https://www.facebook.com/profile.php?id=61594888052765, id 61594888052765, category Pub). Instagram **@cheerstestvenue** (https://www.instagram.com/cheerstestvenue/): Peter links it to the Page (section 4, before you record). The Page is not in the Orange Jelly business portfolio (adding it needs Peter to accept Meta's Commercial Terms; optional). Use them for the recording so no test post reaches The Anchor's followers | Peter (Instagram link) |
| A CheersAI brand for the review, with paid ads, tournaments and management import off | Done 28 September 2026: **Cheers Test Venue** (`ebbf257d-6b15-4dcd-80bc-ba557d786364`). It was used for the live Stripe sign-up test (trial started and cancelled, nothing charged), then set to comped (question 35) so it stays free, fully usable and off the 90-day lapsed list | done |
| A CheersAI login for Meta's reviewers with a password, belonging only to Cheers Test Venue | Login made 28 September 2026 (owner of Cheers Test Venue only). Its email is in Peter's private note (`docs/runbooks/meta-app-review-private.md`, kept out of git because this repo is public). Peter sets the password with **Forgot password** on the sign-in page. Give Meta the email and password in the submission form only, never in the repo | Peter (password) |

## 4. The recording

Meta wants one screen recording that shows the whole flow: signing in to CheersAI, Meta's dialog
granting each permission, and CheersAI using each one. The same video is uploaded against all six
permissions.

### Everything you need

| What | Where |
|---|---|
| CheersAI sign-in page | https://cheers.orangejelly.co.uk/login |
| Reviewer login (CheersAI) | Email in your private note `docs/runbooks/meta-app-review-private.md` (on your Mac only, not in git). Password: the one you set with **Forgot password** |
| CheersAI venue it opens | **Cheers Test Venue** (free, fully usable; paid ads, tournaments and event import are off) |
| Test Facebook Page | **Cheers Test Venue**: https://www.facebook.com/profile.php?id=61594888052765 |
| Test Instagram account | **@cheerstestvenue**: https://www.instagram.com/cheerstestvenue/ |
| The saved App Review draft | https://developers.facebook.com/apps/1001401138674450/app-review/submissions/?submission_id=1310539111093983 (or Meta for Developers, CheersAI, **App Review**, **Requests**) |
| Where Meta sends the result | peter@orange-jelly.com (your Meta developer contact email) |

### Before you record (once)

1. **Make @cheerstestvenue a professional account.** In the Instagram app, signed in as
   @cheerstestvenue: **Profile**, the menu (three lines), **Account type and tools**, **Switch to
   professional account**, choose **Business**. Instagram only lets apps publish to professional
   accounts.
2. **Link it to the Page.** On Facebook, open the Cheers Test Venue Page, click **Switch** to act as
   the Page, then **Settings**, **Linked accounts**, **Instagram**, **Connect account**, and sign in
   as @cheerstestvenue. The Page's Linked accounts screen should then show @cheerstestvenue.
3. **Set the reviewer login's password.** On https://cheers.orangejelly.co.uk/login click **Forgot
   password**, enter the reviewer email from your private note, open the email (it arrives in your
   Outlook inbox) and set a password. Sign in once to check it opens Cheers Test Venue.
4. **Have an image ready**: a square JPG of food or drink, about 1080 x 1080 pixels and under 8 MB.
   Instagram needs an image on every post.
5. **Set up the screen.** Browser and Facebook in English, browser zoom at 100%, close other tabs
   and notifications (Focus mode on). Sign in to Facebook in the same browser as yourself (your
   account has a role on the app, so Meta's dialog works before approval).

### How to record and caption

- Record with the Mac's own recorder: press **Cmd + Shift + 5**, choose **Record Selected Portion**
  (or the whole screen), click **Record**; stop it from the menu bar. Aim for 1080p or better.
- Add a short on-screen caption for each step below (Meta's reviewers cannot rely on a
  voice-over). iMovie works: drag the video in, then **Titles**, **Lower Third**, over each step.
  Export at 1080p as .mp4 or .mov.
- Cut out waiting time (for example the ten minutes before the story posts).

### The steps (caption for each in quotes)

1. **Sign in.** Open https://cheers.orangejelly.co.uk/login, enter the reviewer email and password,
   click **Sign in**. Caption: "Venue owner signs in to CheersAI."
2. **Connect Facebook.** Go to **Connections**. The **Facebook Page** card says "Connect Facebook
   before publishing." Click **Connect**. Caption: "Owner connects their Facebook Page."
3. **Meta's dialog.** Show the dialog listing the permissions. When it asks which Pages to share,
   tick **only Cheers Test Venue** (untick The Anchor and Orange Jelly), and if it asks about
   Instagram accounts or business portfolios, choose only @cheerstestvenue. Continue. Caption:
   "CheersAI asks only for the permissions it needs to publish." (If you share more than one Page,
   CheersAI asks you to choose one; choose Cheers Test Venue.)
4. **Back in CheersAI.** The message "Connected facebook successfully" appears and the card shows
   the Page name, with Publishing "Ready" and Access token "Stored". Caption: "pages_show_list and
   pages_read_engagement: CheersAI lists the Pages and reads the Page name."
5. **Connect Instagram.** On the **Instagram Business** card, click **Connect** and complete Meta's
   dialog the same way, choosing only @cheerstestvenue. The card then shows the Instagram username
   and says it uses the Page connected to Facebook. Caption: "instagram_basic: CheersAI reads the
   linked Instagram account's username."
6. **Create a post.** Go to **Create**. On **Brief**, choose **Instant Post**, enter a title and a
   short brief, tick **Facebook** and **Instagram**, click **Next**. On **Media**, attach your
   image, **Next**. On **Schedule**, choose **Post Now**, **Next**. On **Generate**, click
   **Generate Content**, then **Approve this post**, then **Post approved (1)**. Caption: "Owner
   writes, reviews and approves the post before anything is published."
7. **It publishes.** In the **Planner**, open the post; the status moves from "Queued" to
   "Publishing" to **"Published"** (usually within a couple of minutes). Caption:
   "pages_manage_posts and instagram_content_publish: CheersAI publishes the approved post."
8. **Show it live.** In new tabs, open https://www.facebook.com/profile.php?id=61594888052765 and
   https://www.instagram.com/cheerstestvenue/ and show the post on each. Caption: "The post is live
   on the venue's Page and Instagram."
9. **A story.** Back in **Create**, choose **Story**, tick Facebook and Instagram, attach an image,
   on **Schedule** use the **In 10 min** quick button, then **Generate Content** and **Schedule
   stories (1)**. When the planner shows "Published", show the story on the Page and on Instagram.
   (Stories cannot be posted instantly; cut the wait from the video.) Caption: "CheersAI also
   publishes approved stories."
10. **Disconnect.** On **Connections**, click **Disconnect** on each card and confirm. Caption:
    "Owners can disconnect at any time; CheersAI deletes the stored tokens."

### After recording: finish the draft and submit

1. Open the saved draft (link in the table above). **Reviewer instructions**: in the test login
   box, type the reviewer password after "Password:". Remove the old file "CheersAI Supporting
   Documentation.pdf" (from August 2025; it describes the old set-up).
2. **Allowed usage**: for each of the six permissions click **Get started**, upload the video,
   tick "If approved, I agree...", and **Save**. The descriptions are already filled in.
3. **Data handling**: check the four boxes about requests from public authorities are still true
   for Orange Jelly.
4. Click **Submit for review**. If Meta then asks for **Access Verification**, complete it. Tell
   Claude the date you submitted (it is recorded in spec D7).

## 5. Text for the submission form

Paste one block into each permission's "How will your app use this permission?" box.

**pages_show_list**
> CheersAI is a social media scheduling tool for pubs, bars and restaurants. When a venue owner
> connects Facebook on the Connections page, CheersAI calls /me/accounts to list the Pages they
> manage so it can link the venue's own Page. It only lists Pages; the owner chooses which Pages
> to share in Meta's dialog.

**pages_read_engagement**
> When the owner connects, CheersAI reads the Page's id, name and Page access token, and the
> Instagram professional account linked to that Page. The Page name and Instagram username are
> shown on the Connections page so the owner can see what is connected. The Page access token is
> used, encrypted at rest, to publish the posts the owner approves. CheersAI does not read the
> Page's posts, followers or insights.

**pages_manage_posts**
> Venue owners write posts in CheersAI (text plus an image), review and approve each one, and
> choose to post now or at a scheduled time. CheersAI then publishes the approved post or story to
> the venue's Facebook Page via /{page-id}/feed, /{page-id}/photos and /{page-id}/photo_stories.
> Nothing is published without the owner's approval, and CheersAI never edits or deletes existing
> Page content.

**instagram_basic**
> CheersAI reads the id and username of the Instagram professional account linked to the venue's
> Page, to show the owner which account is connected and to publish to it. After an unclear
> publishing failure it reads the account's content publishing limit so it can tell the owner
> whether the daily limit was reached. It does not read media, comments or followers.

**instagram_content_publish**
> Venue owners approve each post and story in CheersAI before it goes out. CheersAI then creates
> the media container and publishes it to the venue's Instagram professional account via
> /{ig-id}/media and /{ig-id}/media_publish, either immediately or at the time the owner chose.

**business_management**
> Many venues keep their Facebook Page in a Meta business portfolio. CheersAI requests
> business_management so that, when the owner connects, Pages held in their business portfolio
> are returned by /me/accounts and can be linked. CheersAI makes no other Business Manager API
> calls and does not create, read or change business assets or users.

**App verification details (test instructions)**
> 1. Go to https://cheers.orangejelly.co.uk/login and sign in with the email and password below.
> 2. Open Connections from the menu. Click Connect on the Facebook Page card and complete
>    Meta's dialog with a Page you manage. Repeat on the Instagram Business card (the Page must
>    have an Instagram professional account linked).
> 3. Open Create. Choose Instant Post, enter a title and brief, tick Facebook and Instagram, click
>    Next, attach an image, click Next, choose Post Now, click Next, then Generate Content,
>    Approve this post and Post approved (1).
> 4. Open Planner to see the post move to Published, then view it on the Page and Instagram.
> 5. Connections, Disconnect removes the connection and its stored tokens.
>
> Email: (reviewer login)  Password: (reviewer password)

## 6. Submit

In the App Dashboard: **App Review, Permissions and Features**. For each permission in section 2,
click **Request advanced access**, add the form text and the recording, then submit from **App
Review, Requests**. Meta gives no fixed turnaround. Record the submission date in spec D7.

## 7. After approval

1. Check each permission shows Advanced access on the dashboard.
2. The D7 launch gate: a real venue person with no role on the app connects their own Page and
   Instagram and publishes one agreed post. Check the Instagram post in particular (section 2,
   known risks).
3. Remove any temporary testers who no longer need the role.
4. Record the result in spec D7 and in this runbook.

If Meta rejects a permission, read the feedback in **App Review, Requests**, fix what it names,
and resubmit that permission only.

## 8. Open items found while preparing this

- Fixed 27 September 2026: the connect button used to read **Reconnect** on a brand that had
  never connected. It now reads **Connect** whenever no connection is stored, and **Reconnect**
  only when a stored connection needs fixing.
- The **Publish now**, **Save changes** and **Cancel this post** buttons on the single post page
  (`src/app/(app)/planner/[contentId]/page.tsx`) have no action.
- CheersAI stores only the Meta post id, not a link to the live post, so the recording shows the
  post by opening the Page and profile directly.
