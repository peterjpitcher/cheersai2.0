# Story calendar artwork

The create day selector signs the legacy original image for every placement. Live Cash Bingo story rows have a story derivative, but the calendar never reads it. Select placement-aware preview candidates from the account's media assets and retain the legacy fallback for older assets. Keep feed previews and publishing behaviour intact.

One small deployable fix: the calendar read action and regression tests. No schema, settings or content changes. Rollback by reverting this commit and redeploying. No migration is required.

Validation: reproduce square selection in an action regression test, cover both platforms, feed/story selection, fallback and lookup/signing errors; run ci:verify and UTC tests; inspect the live create calendar after deployment.

Results: the regression failed with the original square URL for both platforms, then passed with the story derivative. Lint, typecheck, build and both London and UTC suites passed (2,221 passed, three skipped in each zone). Live browser before deployment confirmed Cash Bingo story images were 1080 by 1080.
