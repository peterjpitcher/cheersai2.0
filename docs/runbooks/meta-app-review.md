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
| Privacy policy at `https://cheers.orangejelly.co.uk/privacy` | **Blocking until deployed.** Rewritten on 27 September 2026 (plan item 2.10, branch `feat/legal-terms-privacy-dpa`) with the correct company details, London hosting and a Facebook and Instagram section including deletion steps. The live page keeps the wrong address until that branch is merged and deployed | Claude |
| Terms at `https://cheers.orangejelly.co.uk/terms` | Set; rewritten with the privacy policy on the same branch | Claude |
| Data deletion callback `https://cheers.orangejelly.co.uk/api/social/delete-data` | Set, live; a forged request returns 400 | done |
| Deauthorise callback | Set by Peter, 26 September 2026 | done |
| App icon, category, contact email (`peter@orangejelly.co.uk`), app domain | Set | done |
| Business Verification | Verified | done |
| A test Facebook Page linked to a test Instagram professional account, held in the Orange Jelly business portfolio | Not yet made. Use it for the recording so no test post reaches The Anchor's followers | Peter |
| A CheersAI brand for the review, with paid ads, tournaments and management import off | Done 28 September 2026: **Cheers Test Venue** (`ebbf257d-6b15-4dcd-80bc-ba557d786364`). It was used for the live Stripe sign-up test (trial started and cancelled, nothing charged), then set to comped (question 35) so it stays free, fully usable and off the 90-day lapsed list | done |
| A CheersAI login for Meta's reviewers with a password, belonging only to Cheers Test Venue | Not yet made. Admin, invite a new email address with access to Cheers Test Venue only, then set the password from the invite email. Give Meta the email and password in the submission form only, never in the repo | Peter |

## 4. The recording

Meta wants a screen recording that shows the whole flow: signing in to CheersAI, Meta's login
dialog granting each permission, and CheersAI using each one. One recording can cover all six
permissions; upload the same file against each. Record at 1080p or better, with the browser and
Meta in English, and add short on-screen captions for each step (Meta's reviewers cannot hear a
voice-over reliably). Record it as Peter, who has a role on the app, using the test Page.

1. **Sign in.** Open `https://cheers.orangejelly.co.uk/login`, enter the reviewer email and
   password, click **Sign in**. Caption: "Venue owner signs in to CheersAI."
2. **Connect Facebook.** Go to **Connections**. The **Facebook Page** card says "Connect Facebook
   before publishing." Click **Connect**. Caption: "Owner connects their Facebook Page."
3. **Meta's dialog.** Show the dialog listing the permissions. Choose the test Page (and its
   business portfolio if asked) and continue. Caption: "CheersAI asks only for the permissions it
   needs to publish."
4. **Back in CheersAI.** The toast "Connected facebook successfully" appears and the card shows the
   Page name, with Publishing "Ready" and Access token "Stored". Caption: "pages_show_list and
   pages_read_engagement: CheersAI lists the Pages and reads the Page name."
5. **Connect Instagram.** On the **Instagram Business** card, click **Connect** and complete Meta's
   dialog the same way. The card then shows the Instagram username. Caption: "instagram_basic:
   CheersAI reads the linked Instagram account's username."
6. **Create a post.** Go to **Create** ("Create Content"). On **Brief**, choose **Instant Post**,
   enter a title and a short brief, tick **Facebook** and **Instagram**, click **Next**. On
   **Media**, attach an image (Instagram needs one), **Next**. On **Schedule**, choose **Post Now**,
   **Next**. On **Generate**, click **Generate Content**, then **Approve this post**, then
   **Post approved (1)**. Caption: "Owner writes, reviews and approves the post before anything is
   published."
7. **It publishes.** In the **Planner**, open the post; the status moves from "Queued" to
   "Publishing" to **"Published"**. Caption: "pages_manage_posts and instagram_content_publish:
   CheersAI publishes the approved post."
8. **Show it live.** In another tab, open the test Facebook Page and the test Instagram profile and
   show the post. Caption: "The post is live on the venue's Page and Instagram."
9. **A story.** Go back to **Create**, choose **Story**, tick Facebook and Instagram, attach an
   image, and on **Schedule** use the **In 10 min** quick button, then **Generate Content** and
   **Schedule stories (1)**. When the planner shows "Published", show the story on both. (Stories
   cannot be posted instantly, so this part takes about ten minutes; cut the wait from the video.)
   Caption: "CheersAI also publishes approved stories."
10. **Disconnect.** On **Connections**, click **Disconnect** on each card and confirm. Caption:
    "Owners can disconnect at any time; CheersAI deletes the stored tokens."

Do not click **Publish now**, **Save changes** or **Cancel this post** at the foot of a single
post's page (`/planner/<id>`): they do nothing at present.

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
