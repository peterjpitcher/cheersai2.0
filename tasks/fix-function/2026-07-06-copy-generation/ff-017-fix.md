# FF-017 — Bare-domain regex blanking sentences at period-no-space (fixed 2026-07-06)

## Root cause
`DIRECT_LINK_PATTERN` (social-links.ts) matched a bare domain as
`\b(?:label\.)+[a-z]{2,}(?:/…)?` with the `/i` flag. The `/i` on `[a-z]{2,}` let a capitalised
trailing label count as a TLD, so any two words joined by a full stop with NO following space were
read as a domain:
- "Great food.Great drinks.See you soon." -> "food.Great","drinks.See" matched.
- Single-line missing-space prose -> `stripDirectLinkSentences` split found only one sentence and
  returned "" -> the whole post body was published EMPTY.
Correctly punctuated copy (period + space) never fired, so it slipped past tests but detonated on
real missing-space model output. Reached via sanitizePublishBody / stripDirectLinkSentences on the
live publish path and content-rules.ts.

## Fix
Restrict the bare-domain alternative's final label to a curated TLD list
(`com|co|org|net|io|uk|pub|info|biz|app|dev|shop|store|…`) instead of any `[a-z]{2,}`, with a `\b`
after the TLD so a longer word can't match a TLD prefix ("Comedy" ≠ "com"+"edy"). Scheme-based
(`https://`) and `www.` links still match regardless of TLD via the first alternative, so any
properly-formed URL is always caught. `DIRECT_LINK_WITH_LEADING_PREPOSITION` (FF-016) derives from
`DIRECT_LINK_PATTERN.source`, so it inherited the stricter matching automatically.

Prototyped and validated in isolation before editing: all reported false positives killed, all real
domains (incl. the-anchor.co.uk, vip-club.uk, www., https://, sentence-final "example.com.") still
match.

## Tests
Added period-no-space regression tests to social-links.test.ts and copy-rules.test.ts (stripDirect-
Links, stripDirectLinkSentences, sanitizePublishBody) plus multi-label/real-TLD matches.

## Verification
lint ✓ · typecheck ✓ · tests 1653 passed / 2 skipped (+4) ✓ · build ✓

## Known residual (documented, low severity)
A false positive still needs the word after a missing-space full stop to be EXACTLY a TLD token
(e.g. "the pub.Pub quiz" -> "pub.Pub"). This is far narrower than the old "any capitalised word" and
requires a specific coincidence; full URLs (https://) remain the reliable, always-matched path. Not
worth a heuristic that would also miss capitalised real domains.
