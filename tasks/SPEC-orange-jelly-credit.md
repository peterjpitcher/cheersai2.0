# Orange Jelly footer credit

The public site's footer (`src/features/marketing/site-footer.tsx`) gains one line under the company details: "Built and maintained by Orange Jelly", where only "Orange Jelly" is a link. Every site Orange Jelly builds carries the same line, and orangejelly.co.uk owns the wording and the link, so one edit there changes every footer.

The line comes from the per-site feed at `https://www.orangejelly.co.uk/api/credit/cheers`, read on the server (`src/lib/marketing/orange-jelly-credit.ts`) and cached for 24 hours. If the feed is unreachable, slower than 3 seconds, malformed, or links anywhere except `https://www.orangejelly.co.uk`, the footer shows a built-in fallback line linking to the Orange Jelly home page, so the line never disappears and the feed can never place a foreign link here. The code is a copy of the reference in `docs/credit/README.md` of the orangejelly.co.uk repo; keep the two in step.

It renders on every page that uses the marketing footer: the homepage, the guides index and articles, the legal pages and the Help Centre. The app itself (`(app)` routes) has no marketing footer and is unchanged.

No schema, environment or security header change: the fetch runs on the server, and the line is plain server-rendered HTML. The feed ships with orangejelly.co.uk's own release; until it is live the footer shows the fallback line and builds log `[orange-jelly-credit] showing the fallback line`, which is expected. Next.js caches only successful fetches, so nothing bad is cached meanwhile. Roll back by reverting the commit.
