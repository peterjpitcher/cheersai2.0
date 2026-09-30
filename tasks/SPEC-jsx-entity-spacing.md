# SPEC: no missing spaces in the built pages

## Why

The live terms page read "agreement between Orange Jelly Limited(“we”, “us”)": the space after the
company name was missing although the source has it. The Data Processing Agreement had the same
fault ("Orange Jelly Limited(“we”, the processor)", "Other help.We help", "Not sub-processors.Stripe")
and so did the terms' section 14 ("Data Processing Agreementcovers").

## Cause

`next build` compiles JSX with SWC. SWC drops the leading space of a run of JSX text when that run
contains an HTML entity (`&ldquo;`, `&apos;`, `&rsquo;`, `&middot;` and so on) and carries on to
another line. The space goes whenever the run starts straight after an expression (`{COMPANY.legalName}`)
or an element (`</strong>`). A run on a single line, or one without an entity, keeps its space.
Vitest compiles JSX with a different compiler that keeps the space, so the existing page tests
could not see it.

## Change

- Put an explicit `{" "}` before each affected run. No wording changes.
- Nine places: the terms (2), the Data Processing Agreement (3), the first-post help page, the post
  page's "couldn't accept this post" heading, the planner's date line, and the admin page's new
  ingest key notice.
- `src/app/jsx-text-spacing.test.tsx` compiles the terms and the Data Processing Agreement with
  Next's own SWC, renders them and checks the spaces, and scans every `.tsx` file in `src/` for the
  shape SWC mangles.

## Rollback

Revert the PR. No migration, no data change, no environment variable.
