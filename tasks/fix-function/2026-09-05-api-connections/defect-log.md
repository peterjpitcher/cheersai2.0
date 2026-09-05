# Defect log

| ID | Type | Severity | Confidence | Evidence and root cause | Impact | Fix and acceptance | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| FF-C01 | Observability | Medium | High | Settings test checked only listManagementEvents | Broken conversions/artwork/menu could pass | GET-check read capabilities; disclose untested writes and empty-event limits | Verified locally; full gates pass |
| FF-C02 | Data risk | High | High | loadManagementBookingConversionEvents returned [] on failure | Recommendations based on incomplete booking evidence | Abort and persist failed run with safe error; no recommendations on HTTP or shape failure | Verified locally; full gates pass |
| FF-C03 | Data risk | High | High | loadBlendedBookingSignals discarded first-party database failures | Same misleading zero-booking input | Abort before recommendations; regression injects DB failure | Verified locally; full gates pass |
| FF-C04 | Validation | Medium | High | Management client treated missing event, specials and conversions arrays as empty | Diagnostics could pass malformed upstream response | Reject malformed response shapes | Verified locally; full gates pass |

All are user-approved safe in-scope changes. Sibling search covered both conversion loaders and diagnostic read paths. No PII or credential logging added. Management endpoint and API key permissions belong to root, not this branch. External writes remain untested deliberately.

## Verification

- npm run ci:verify passed: zero-warning lint, typecheck, 230 test files passed, 2 skipped; 2,076 tests passed, 3 skipped; fresh webpack production build passed with no prior .next directory.
- npm run test:utc passed with the same totals.
- Exact new Settings check helper executed against the configured live connection using GET only. It rejected the verified live failure: Management API request failed (500): Failed to load event booking conversions. Root must repeat after deploying the management endpoint repair.
- Failure-injection tests prove no recommendations are inserted and the run is marked failed when either booking source fails. HTTP 500 and malformed success responses are covered; sensitive upstream response content is not persisted.
- One focused follow-up pass covered Settings summary, both conversion loaders, manual dashboard error return and cron all-failed HTTP status. No further verified in-scope defects found.
- Browser Settings submission was not run because that would persist a live diagnostic status. The exact read-check helper was run instead. No publishing, payment or advertising writes were executed.
- No migrations. No files in the original checkout changed. Local isolated branch only; root coordinates packaging and deployment.

## Review follow-up

Root identified one remaining false-empty path: malformed rows in an otherwise valid management conversion array were discarded, and success:false envelopes with arrays were accepted. The optimiser now validates UUID IDs, an ISO datetime with offset, optional positive integer ticket counts and typed optional metadata before mapping any rows. A malformed row fails the run. Regression cases cover invalid IDs, invalid dates, zero tickets, empty objects, failed envelopes and a valid response. The connection helper fixture now uses a valid UUID matching the producer query contract. Second focused pass complete; no scope expansion.

Final follow-up gates passed: lint, typecheck, production build and both London/UTC full suites (2,076 passed, 3 skipped in each). After root removed the unused payment scope from the live Cheers key, authenticated GET events, specials and artwork each returned 200. No secrets printed and no live diagnostic status persisted.

## Campaign source and batch contract review

Live read-only aggregate found 10 campaigns, all management_event with event IDs and snapshots, including 9 active. There is no current non-event campaign incident. The accepted creation contract nevertheless allows custom_promotion source IDs, and the campaign query has no 100-campaign cap. The loader now uses explicit snapshot eventId or event/management_event sources only, and splits distinct IDs into batches of at most 100 to match the management API contract. It does not filter malformed actual event IDs into an empty result; upstream rejection still fails the run. Regression tests cover a custom promotion with no management request and 101 event IDs split into 100 and 1.

Source/batch follow-up final gates passed: lint, typecheck, production build, London and UTC suites with 2,078 passed and 3 skipped each.
