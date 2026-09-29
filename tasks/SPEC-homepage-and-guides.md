# SPEC: Public homepage and guides infrastructure

Status: built on `feat/homepage-and-guides`, 29 September 2026; review fixes applied the same day. No migration, no new environment variable, no production setting.
Owner: Peter Pitcher. Author: Claude.
Parent: `tasks/SPEC-self-serve-signup.md` (§4.1 the front door, decision P11 on indexing, which §3 below replaces for these pages).

## 1. Why

On 29 September 2026 Peter asked for "a public facing homepage that explains what Cheers is and what it does for businesses", and for 20 to 25 SEO articles on social media practice for hospitality businesses. The articles follow a keyword plan, so this change builds the homepage and the article ("guides") infrastructure only. No real article ships; a test fixture proves the pages.

## 2. What changes

1. **Homepage** (`/`, `src/features/front-door/`): the #142 landing page becomes a full marketing page: hero, how it works (four steps), features written as benefits, who it is for (pubs, bars, restaurants, cafes, hotels), prices from `PLANS` (ex VAT, the yearly saving computed from `PLANS`), what you need, the free trial as the terms word it, FAQs with matching `FAQPage` JSON-LD, a trust section with the company details, a switch-aware call to action, a header (Sign in, Guides, the call to action) and a footer (Guides, the three legal pages, Help, Sign in, company details). `Organization`, `WebSite` and `SoftwareApplication` JSON-LD (offers from `PLANS`, VAT excluded). Open Graph and Twitter metadata with a generated image.
2. **Copy in one place**: titles and descriptions for every public page in `src/content/seo.ts`, so the keyword plan can tune them; homepage copy in `src/content/homepage.ts`.
3. **Guides**: one module per article in `src/content/guides/`, typed (`types.ts`), checked and given a computed reading time by `defineGuide` (`src/lib/guides/define-guide.ts`), listed in `src/content/guides/index.ts` (empty today). Bodies are structured sections (headings, paragraphs, lists, tips, a closing call to action) rendered by React components: no MDX, no raw HTML. `/guides` groups articles by category (`ItemList` JSON-LD); `/guides/[slug]` has `generateStaticParams`, `generateMetadata` with a canonical URL, `Article` and `BreadcrumbList` JSON-LD, a table of contents from the H2s, related guides, a call-to-action box that follows the switch, and the last-updated date in London time (`formatUkLongDate`).
4. **SEO plumbing**: `src/app/sitemap.ts`; `robots.ts` allows `/`, the legal pages, `/guides` and the sitemap, and names the sitemap; `/guides`, `/guides/<slug>` and the images the structured data names join the X-Robots-Tag exemption in `headers.ts`; every absolute URL comes from `NEXT_PUBLIC_SITE_URL` through `src/env.ts` (`src/lib/marketing/site.ts`).
5. **Open Graph images**: route handlers `/og` (homepage) and `/og/guides/<slug>`, drawn with `next/og` in the design tokens (`src/lib/design/tokens.ts`, a mirror of `globals.css` that a test keeps identical).

## 3. Public before sign-up opens

Peter decided on 29 September 2026 to publish the homepage and the guides as soon as they are ready, before sign-up opens, because search engines take weeks to find new pages. He answered "yes" to: "Make the homepage and guides public as soon as they're ready, even if sign-up waits for Meta? The button would say Talk to us until sign-up opens." So these pages no longer follow `app_flags('self_serve_signup')`; only the call to action does, and anything other than `open` (off, unreadable, or on while `billing_enforcement` is off) counts as closed.

| Surface | Sign-up closed, or the switch unreadable | Sign-up open |
|---|---|---|
| `/` signed in | 307 to `/planner` | the same |
| `/` signed out | homepage with "Talk to us" (email and WhatsApp), indexable | homepage with "Start your free trial", indexable |
| `/guides`, `/guides/<slug>` | shown once at least one guide exists (otherwise not found), with "Talk to us" | the same, with "Start your free trial" |
| Guides links in the header, footer and homepage | only once at least one guide exists | the same |
| The three legal pages | indexable | the same |
| `robots.txt` | allows `/`, the legal pages, `/guides`, the files those pages need and `/sitemap.xml`; names the sitemap | the same |
| `/sitemap.xml` | `/`, `/guides` and every guide (when there are guides), the three legal pages, each with its content date | the same |
| `/og`, `/og/guides/<slug>` | the share images (an unknown guide is not found) | the same |

`robots.txt`, the sitemap, the share images and the legal pages' metadata do not read the switch at all, so a database problem can never hide them or answer "disallow everything"; the homepage and guide pages read it only for the call to action, and show "Talk to us" when it cannot be read. A Vercel Preview shows what production shows (Vercel sends `x-robots-tag: noindex` there).

## 4. Decisions made while building

- **Guides need at least one article.** With no articles, `/guides` is not found and nothing links to it, so the site never shows an empty page.
- **robots.txt, when open, also allows the files the open pages need**: `/_next/static/`, `/_next/image`, `/brand/` (the logo in the JSON-LD), `/og` (the share images; X's crawler obeys robots.txt), the favicons and `/sitemap.xml` (Google fetches a sitemap only if robots.txt allows it). They are files, not pages, so the pages that may be indexed are still only those P11 names plus the guides. `src/lib/marketing/crawlability.test.ts` runs Google's matching rule over the open robots.txt and checks that the sitemap, every page it lists and every image the structured data names can be fetched and carry no X-Robots-Tag.
- **Open Graph images are route handlers, not the `opengraph-image` file convention.** A root `opengraph-image` would add an `og:image` tag to every page, including `/login` and the app. `/guides` shares the homepage image and its alt text; there is no separate index image.
- **The token mirror.** `next/og` cannot read CSS variables, so `src/lib/design/tokens.ts` copies the colour tokens from `globals.css`; `tokens.test.ts` fails if any value drifts.
- **X-Robots-Tag exemption**: `/guides` and `/guides/<slug>` (one level deep), and the images the structured data names, which Google's Organization and Article guidelines require to be indexable: a file directly in `/brand` (the logo) and `/og` and `/og/guides/<slug>` (the share images). Anything deeper keeps the header.
- **`SoftwareApplication` JSON-LD stays, for search engines and AI assistants to understand what Cheers is and costs.** It can never earn Google's software app rich result, which needs `aggregateRating` or `review`, and we never add ratings or reviews. The Rich Results Test calling it ineligible is expected, not a fault to fix.
- **Accessible colours.** Body links use `--c-orange-hi` (5.4:1 on white). Calls to action are ink text on `--c-orange` (5.1:1), turning white on `--c-orange-hi` on hover (5.4:1). `--c-ink-3` is never used on `--c-paper-2`. Text on the ink band over the orange glow is white or `--c-line-2` (6.8:1 at the glow's centre), never `--c-ink-4`. The glow is a circle sized to the closest side, central below `lg` (at the top edge of the planner card, lighting it from behind), so it never becomes a streak behind the text; the planner grid lines are 4% white, so 12px orange eyebrows crossing one still pass 4.5:1.
- **FAQ answers are structured text**, so the JSON-LD answer is exactly the visible answer, links included as their words.
- **Yearly saving** is computed from `PLANS` (10% today), shown as a percentage so no price appears that `PLANS` does not hold.
- **No customer names, ratings, testimonials or statistics.** Paid ads, tournaments and the management-app import are not mentioned (they are off for new brands). One list of banned claims (`src/content/claims.ts`: ads, campaigns, tournaments, Google and Business Profile, TikTok, LinkedIn, Twitter or X, the management app and its import) is checked against the homepage, the fixed words on the guide pages, the search titles and descriptions, and every guide's closing. Article bodies are left out: they may fairly discuss other platforms.
- **Section anchors cannot reuse the guide page's own ids** (`main`, `guide-contents-title`, `related-title`); `defineGuide` refuses them, and a page test fails if the page gains an id that is not on that list.

## 5. Adding a guide (after the keyword plan)

1. Write `src/content/guides/<slug>.ts` exporting `defineGuide({...})`.
2. Add it to the list in `src/content/guides/index.ts`.
3. `npm run test:ci` runs the content checks (dates, links, lengths, anchors, no em dashes, no banned claims in the closing).
4. Merging publishes the guide: it is public and indexable straight away, and joins the sitemap.

## 6. Rollback

Revert the commit "publish the homepage and guides before sign-up opens" to put these pages back behind the switch (`/` then sends signed-out visitors to the login page, `robots.txt` disallows everything, and `/guides`, the share images and the sitemap entries go), or revert the whole PR. Search engines drop the pages over the following weeks; Search Console's Removals tool hides them sooner if needed.

## 7. Before sign-up opens

The homepage's central promises (connect your Facebook Page and Instagram, Cheers does the posting, a free trial with a card) are true for a new venue only once the parent spec's launch gates have passed (`tasks/SPEC-self-serve-signup.md` §4.8 and §6), in this order:

1. Meta App Review approved, with Advanced access for every permission in `docs/runbooks/meta-app-review.md`, and the D7 gate passed (runbook §7). Until then Meta lets only people with a role on the app connect, so a new venue could never publish. The Anchor working is not evidence: Peter connects it as an app administrator.
2. `billing_enforcement` on (P3), so a venue cannot use Cheers without the card-backed trial the page describes.
3. Then `self_serve_signup` on.

Once this is live, in Search Console: request a recrawl in the robots.txt report (Google can keep the cached `Disallow: /` for up to 24 hours), then submit `https://cheers.orangejelly.co.uk/sitemap.xml`. None of that waits for sign-up to open.
