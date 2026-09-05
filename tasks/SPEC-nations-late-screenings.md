# Conditional late finishes for The Anchor

Owner decision, 5 September 2026: for games running past usual closing time, stay open until the match finishes if people are still in watching.

Use an additive screening.lateFinishPolicy value of stay_open_if_viewers for eligible late screenings owned by The Anchor. Other brands retain their existing policy. Normal opening, kitchen service, booking arrival limits and planned booking windows remain unchanged. The conditional continuation is not a guaranteed new closing time or an invitation to arrive after usual closing.

The website consumes the optional policy for game cards, booking details and calendar descriptions, and updates its editorial and SSOT. Cheers uses the same conditional sentence in the feed opening label and generated captions/artwork. The template contract version changes, so deploy the matching publish worker and regenerate the one existing game's four future posts without changing its three-day schedule.

Rollout: website compatibility first, then Cheers and matching worker, then refresh existing content. No migration or hours-table changes. Rollback uses the prior application release and matching template contract; regenerate unpublished affected content if reverting.
