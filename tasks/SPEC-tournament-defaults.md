# Tournament names and scheduling defaults

The owner wants the tournament name visible on generated overlays and a configurable lead time for each tournament. Nations Championship 2026 must use three days before each game.

## Decisions
- Reuse the existing account-scoped tournaments.post_lead_hours column and validation range of 1 to 168 hours. No schema migration.
- Expose the default clearly in create and settings forms using days and hours, preserving legacy hour values.
- Show tournament.name on square and story overlays. Keep fixture, screening and booking information readable.
- New generation uses the saved default. Settings explain that existing content needs regeneration to use changed timing or artwork.
- Set the verified Nations tournament default to 72 hours. One game already has four future scheduled placements; refresh those through the normal generation path after deploying, retaining future scheduling and not publishing immediately. Do not generate the other games or send any immediate social messages.
- Existing five-minute staggering for simultaneous fixtures remains. Three days means the existing 72-hour interval before kick-off. November fixtures do not cross a clock change.
- Original checkouts, website, management app, kitchen hours and fixture approvals stay unchanged.

## Delivery
Two independently deployable increments: overlay name, then scheduling form controls. Both use the existing schema. Run targeted UI and rendering tests plus full ci:verify and UTC tests. Verify rendered feed/story artwork and the live settings and scheduled timestamps.

## Rollback
Revert the relevant code increment. The prior Nations default is 24 hours. Do not delete published content or modify any unrelated tournament.
