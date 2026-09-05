# Terrestrial rugby bookings

Owner decision, 5 September 2026: show every terrestrial TV game during existing opening hours and accept bookings without waiting for exact channels. ITV's official Nations Championship announcement confirms free-to-air coverage of every fixture.

The existing showing flag records the owner's booking approval. Detailed screen setup remains separate and can stay unconfirmed, so channel, screen and audio fields need not be invented. Broadcast confirmation and its check timestamp remain required. Explicit not-showing, non-terrestrial coverage, finished/cancelled fixtures and unknown/closed hours still prevent bookings. No migration is required.

For approved games with no planned end, use the existing two-hour table-booking default as a planning window, not a claimed match finish. Clip the window to existing bar hours. Show clear warnings when opening misses the start or closing could miss the finish. Promote actual kitchen service overlap and pre-match food separately.

Release website compatibility first, then Cheers, then approve the 24 November fixtures using the verified ITV coverage. Preserve unknown finals opponents. No social sends or real booking tests. Update generated wording so unassigned screens are omitted. Retain detailed screen/audio collision checks when those assignments are confirmed.

Rollback: revert application commits and restore the scoped fixture approval fields from the captured before state if necessary. No schema or hours changes.
