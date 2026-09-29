# SPEC: Public homepage and guides infrastructure

Status: built on `feat/homepage-and-guides`, 29 September 2026. No migration, no new environment variable, no production setting.
Owner: Peter Pitcher. Author: Claude.
Parent: `tasks/SPEC-self-serve-signup.md` (§4.1 the front door, decision P11 on indexing).

## 1. Why

On 29 September 2026 Peter asked for "a public facing homepage that explains what Cheers is and what it does for businesses", and for 20 to 25 SEO articles on social media practice for hospitality businesses. The articles follow a keyword plan, so this change builds the homepage and the article ("guides") infrastructure only. No real article ships; a test fixture proves the pages.

## 2. What changes

1. **Homepage** (`/`, `src/features/front-door/`): the #142 landing page becomes a full marketing page: hero, how it works (four steps), features written as benefits, who it is for (pubs, bars, restaurants, cafes, hotels), prices from `PLANS` (ex VAT, the yearly saving computed from `PLANS`), what you need, the free trial as the terms word it, FAQs with matching `FAQPage` JSON-LD, a trust section with the company details, a switch-aware call to action, a header (Sign in, Guides, the call to action) and a footer (Guides, the three legal pages, Help, Sign in, company details). `Organization`, `WebSite` and `SoftwareApplication` JSON-LD (offers from `PLANS`, VAT excluded). Open Graph and Twitter metadata with a generated image.
2. **Copy in one place**: titles and descriptions for every public page in `src/content/seo.ts`, so the keyword plan can tune them; homepage copy in `src/content/homepage.ts`.
3. **Guides**: one module per article in `src/content/guides/`, typed (`types.ts`), checked and given a computed reading time by `defineGuide` (`src/lib/guides/define-guide.ts`), listed in `src/content/guides/index.ts` (empty today). Bodies are structured sections (headings, paragraphs, lists, tips, a closing call to action) rendered by React components: no MDX, no raw HTML. `/guides` groups articles by category (`ItemList` JSON-LD); `/guides/[slug]` has `generateStaticParams`, `generateMetadata` with a canonical URL, `Article` and `BreadcrumbList` JSON-LD, a table of contents from the H2s, related guides, a call-to-action box that follows the switch, and the last-updated date in London time (`formatUkLongDate`).
4. **SEO plumbing**: `src/app/sitemap.ts`; `robots.ts` allows `/guides` and names the sitemap while the switch is on; `/guides` and `/guides/<slug>` join the X-Robots-Tag exemption in `headers.ts`; every absolute URL comes from `NEXT_PUBLIC_SITE_URL` through `src/env.ts` (`src/lib/marketing/site.ts`).
5. **Open Graph images**: route handlers `/og` (homepage) and `/og/guides/<slug>`, drawn with `next/og` in the design tokens (`src/lib/design/tokens.ts`, a mirror of `globals.css` that a test keeps identical).

## 3. Switch behaviour

Nothing new is public until Peter turns `app_flags('self_serve_signup')` on. Anything other than `open` counts as closed.

| Surface | Switch off or unreadable (production) | Switch on |
|---|---|---|
| `/` signed out | 307 to `/login`, site-wide metadata only (unchanged) | homepage, indexable |
| `/` on a Vercel Preview or local dev server | homepage with "Talk to us", noindex (unchanged, for copy approval) | homepage with "Start your free trial" |
| `/guides`, `/guides/<slug>` | not found, linked from nowhere | shown when at least one guide exists; otherwise not found |
| Guides links in the header, footer and homepage | none | only when at least one guide exists |
| `robots.txt` | disallow everything (unchanged) | allow `/`, the legal pages, `/guides` and the files those pages need; names the sitemap |
| `/sitemap.xml` | an empty sitemap | `/`, `/guides` and every guide (when there are guides), the three legal pages, each with its content date |
| `/og` | not found (except Preview and local dev, like `/`) | the homepage image |
| `/og/guides/<slug>` | not found | the guide's image |

## 4. Decisions made while building

- **Guides need the switch and at least one article.** With the switch on but no articles, `/guides` is not found and nothing links to it, so opening the site before the articles are written never shows an empty page.
- **robots.txt, when open, also allows the files the open pages need**: `/_next/static/`, `/_next/image`, `/brand/` (the logo in the JSON-LD), `/og` (the share images; X's crawler obeys robots.txt), and the favicons. They are files, not pages, so the pages that may be indexed are still only those P11 names plus the guides.
- **Open Graph images are route handlers, not the `opengraph-image` file convention.** A root `opengraph-image` would add an `og:image` tag to every page, including `/login` while the switch is off, and could not follow the switch.
- **The token mirror.** `next/og` cannot read CSS variables, so `src/lib/design/tokens.ts` copies the colour tokens from `globals.css`; `tokens.test.ts` fails if any value drifts.
- **X-Robots-Tag exemption is one level deep**: `/guides` and `/guides/<slug>`; anything deeper (for example `/og/guides/<slug>`) keeps the header.
- **Accessible colours.** Body links use `--c-orange-hi` (5.4:1 on white). Calls to action are ink text on `--c-orange` (5.1:1), turning white on `--c-orange-hi` on hover (5.4:1). `--c-ink-3` is never used on `--c-paper-2`.
- **FAQ answers are structured text**, so the JSON-LD answer is exactly the visible answer, links included as their words.
- **Yearly saving** is computed from `PLANS` (10% today), shown as a percentage so no price appears that `PLANS` does not hold.
- **No customer names, ratings, testimonials or statistics.** Paid ads, tournaments and the management-app import are not mentioned (they are off for new brands).

## 5. Adding a guide (after the keyword plan)

1. Write `src/content/guides/<slug>.ts` exporting `defineGuide({...})`.
2. Add it to the list in `src/content/guides/index.ts`.
3. `npm run test:ci` runs the content checks (dates, links, lengths, no em dashes).

## 6. Rollback

Revert the PR. With the switch off, production serves what it serves today; the only new public responses are an empty `/sitemap.xml` and 404s from `/og` and `/guides`.

## 7. Before the switch is turned on

Nothing else must deploy first. After opening, submit `https://cheers.orangejelly.co.uk/sitemap.xml` in Search Console.
