# Developer review: temporal date context in content generation prompts

Review date: 9 September 2026. Assessment: **not ready for implementation as a complete specification**. The post-now correction is well motivated, but the proposed validator can still accept incorrect copy, the proposed drift baseline is not written to the final batch items, and the warning and regeneration journeys are incomplete.

This is a separate review of the supplied draft dated 8 September 2026. The original specification has not been rewritten. Review evidence is from local checkout `20a384f`, branch `chore/agent-instruction-files`, with existing uncommitted work present. No production state, deployment, external endpoint usage or live schema was inspected. Findings about code describe the checked-out implementation, not a verified production incident.

## Evidence and classification

The five existing suites for temporal context, proximity labels, label parity, content rules and post-processing passed: **111 tests in Europe/London and 111 in UTC**. Commands used were `npm run test:ci --` and `npm run test:utc --`, each followed by the five corresponding test paths under `tests/lib/`. These tests establish the current regression baseline, not acceptance of the proposed changes. No full build, full CI run or browser publishing journey was run because this is a read-only specification review.

Additional read-only probes of the real functions established that:

- `applyChannelRules` converts `Join us Saturday. Sunday roast follows.` to `Join us . roast follows.` when the reference event is Saturday, with `day_names_removed`.
- For a promotion starting 19 September and ending 30 September, a post on 14 September gets overlay `THIS SATURDAY` but an instruction about finishing on Wednesday 30 September.
- For a noon event and a 07:00 post on the same day, the overlay is `TODAY` while the temporal instruction permits `tonight`.

Priority: **P1** must be resolved before the affected phase is approved for implementation; **P2** must be specified before that phase is released; **P3** optional improvement. No P0 incident is asserted. Each finding identifies its status and type. Open product questions are raised in the accompanying chat, as required by the project rules; D1 to D4 below link to those decisions without putting unanswered questions in this file. Implementation details with no product choice have a recommended resolution rather than an unnecessary question.

## Findings

### R01. The drift baseline is absent from the final batch items

**Priority / type / status:** P1 / data contract / confirmed code gap in the proposal.

**Section:** 2.6, 3.1, 3.2, 4 and file list.

**Description and evidence:** The cited `ai-generate.ts:111` write is to the draft `contentId`. `generate-step.tsx:531` calls generation for multiple slots using that same ID. `createScheduledBatch` in `src/app/actions/content.ts:876` then constructs new content rows for each slot, platform and placement. Those rows receive `prompt_context`, but the insert payload does not copy `ai_generation_params.generationContext.scheduledAt`. The spec therefore does not establish a reliable per-caption baseline for its principal save journey. A shared draft field also cannot represent all generated slots.

**Rationale / impact:** Phase 3 can miss drift entirely or compare against the wrong slot. A nullable schedule also cannot record the actual instant used for post-now generation.

**Recommended action:** Define a per-item or per-variant generation reference, including effective publish instant, timezone and the body revision it describes. Carry that reference through batch creation, manual edits and regeneration. An existing JSON field may suffice without a schema migration, but name its shape, ownership and legacy fallback. Treat absent or invalid metadata as unknown, not proof of no drift. Verify final saved rows in an integration test.

**Open-question handling:** No product question; this is a required technical contract.

### R02. A set of acceptable weekdays cannot validate what a sentence means

**Priority / type / status:** P1 / functional correctness / confirmed design defect.

**Section:** 1.5 and lint acceptance tests.

**Description:** With publish day Monday and event day Saturday, the proposed set accepts `The event is on Monday`. It can also reject an accurate mention of Sunday roast merely because Sunday is absent from structured context. `Book today for Saturday` and `The event is today` use the same temporal token for different claims.

**Rationale / impact:** The fix can retain both false approvals and false blocks. A token has to be associated with a claim before it can be judged against an event or deadline.

**Recommended action:** Limit blocking validation to explicitly supported, high-confidence constructions tied to structured facts. Treat ambiguous prose as a review warning. Do not infer that every weekday names the primary event. Define supported forms and include both counterexamples above as acceptance cases. Avoid an unrestricted natural-language date parser for this release.

**Open-question handling:** D2 controls the treatment of unverifiable prose.

### R03. A separate normaliser can still remove legitimate weekdays

**Priority / type / status:** P1 / omitted implementation path / confirmed by execution.

**Section:** 1.5, 2.2 and file list.

**Description and evidence:** `src/lib/ai/content-rules.ts:230` invokes `normalizeDayNames`, independently of `validateDayNames`. Its implementation at approximately lines 706 to 730 removes day names when it sees multiple different weekdays. The probe above reproduced this. `src/lib/tournament/generate.ts` calls `applyChannelRules`.

**Rationale / impact:** Updating lint and `normaliseEventDatePhrasing` alone does not preserve legitimate copy. A later correction stage can destroy the information the validator was meant to check.

**Recommended action:** Inventory every temporal mutation and validation stage, explicitly change or retire the destructive normaliser, and test the complete final-body pipeline. Document whether tournament copy receives the shared fix or remains a declared limitation.

**Open-question handling:** None; make the scope explicit.

### R04. Warning-first conflicts with the current blocking readiness contract

**Priority / type / status:** P1 / workflow and rollout / confirmed contradiction.

**Section:** 3.1 and 4.

**Description and evidence:** Phase 3 adds a named preflight issue but deployment says warnings first. `preflight.ts:10` defines only code and message. `approve-and-schedule.ts:65` and planner actions at `:1159` block when any issue is returned. Renaming an issue does not make it advisory.

**Rationale / impact:** The specified implementation can unexpectedly stop scheduled work. It also cannot express an advisory issue separately from a connection or media failure.

**Recommended action:** Define warning and blocking severities, structured action results and rendering rules across all callers. State whether saving proceeds and whether the post remains scheduled. Restrict any later blocking rule to confirmed mismatches and define a release gate before enabling it.

**Open-question handling:** D3 determines the initial enforcement policy.

### R05. Reschedule validation currently evaluates the old stored date

**Priority / type / status:** P1 / integration contract / confirmed code gap.

**Section:** 1.5 and 3.1.

**Description and evidence:** `updatePlannerContentSchedule` computes the reserved destination at `planner/actions.ts:1145`, invokes readiness at `:1151`, then saves at `:1166`. Readiness reloads `scheduled_for` from storage in `preflight.ts:253`. There is no proposed-date parameter.

**Rationale / impact:** New temporal lint can pass incorrect destination copy or reject valid corrected copy based on its previous schedule. Planner slot reservation can also adjust the requested time.

**Recommended action:** Pass the final reserved destination instant into a shared temporal evaluator before mutation. Use the same mechanism for approve-now and retry-now. Specify that a rejected reschedule leaves both content and jobs unchanged, and test the action with mocked persistence and queue dependencies.

**Open-question handling:** None.

### R06. The post-now clock is not a single shared reference

**Priority / type / status:** P1 / time and data contract / confirmed specification ambiguity.

**Section:** 1.1 to 1.3.

**Description:** The proposal adds a clock default but does not define precedence between `scheduledAt` and `referenceAt`, where the clock is sampled, or how the same value reaches prompts, overlays, post-processing and persistence. Preview code already has its own clock handling. Invalid schedules currently parse as null and can enter the live branch.

**Rationale / impact:** Generation across London midnight can produce conflicting dates. A malformed schedule must not silently turn a future post into post-now. A post generated before midnight and approved after it has already drifted without rescheduling.

**Recommended action:** Resolve one server-side effective publish instant per operation, require valid zoned values, and pass it through all temporal consumers. Inject the clock in tests. Distinguish absent schedule from invalid schedule. Keep a machine-readable year, date and offset even when the caption omits the year. Reassess time-sensitive copy at approval.

**Open-question handling:** None; default to the project's Europe/London policy and document any account-timezone exception.

### R07. Phase 1 already contains the Phase 2 style change

**Priority / type / status:** P1 / requirements contradiction / confirmed in the draft.

**Section:** Phase 1 heading, 1.3, 2.1 and deployment order.

**Description:** Phase 1 promises no house-style change but its example explicitly permits `this Saturday` while current instructions and post-processing prohibit or replace it. Phase 2 permits relative forms only for one to six days, whereas the shared overlay also emits `NEXT <weekday>` outside that range.

**Rationale / impact:** Developers cannot derive one acceptance oracle or safe intermediate release. The suggested phase dependency does not resolve contradictory instructions within Phase 1 itself.

**Recommended action:** Publish separate vocabulary tables for each release phase. Phase 1 should expose facts and the existing absolute-date style. Phase 2 should deliberately enable agreed relative forms and update all conflicting rules in the same release. Specify the policy for seven or more days, not just one to six.

**Open-question handling:** D1 determines the house-style change.

### R08. Overlay text is not a complete temporal model

**Priority / type / status:** P1 / domain modelling / confirmed by code and probes.

**Section:** 1.3, 1.5 and caption-overlay tests.

**Description and evidence:** Promotions have separate start and end facts: current temporal instructions use the end date, while proximity labels before the promotion use its start. Noon events demonstrate that `TODAY` does not make `tonight` correct. `proximity-label.ts` returns null after an event starts and in other legitimate cases; it cannot supply vocabulary for every prose claim. Weekly recurrence selects a next occurrence rather than representing all recurrence days.

**Rationale / impact:** Requiring exact vocabulary agreement everywhere is either impossible or encourages an incorrect simplification. A caption may correctly describe the end while the image describes the start.

**Recommended action:** Share structured temporal facts and explicit claim targets, then render the caption instructions and image independently. Define agreement as absence of contradictory claims. Specify promotion ranges, ends-only offers, open-ended offers where supported, recurrence with multiple days and no-banner cases. Preserve label banding unless a separately approved change is needed.

**Open-question handling:** None; these are domain definitions needed for acceptance.

### R09. A publish-date anchor cannot resolve free-text intent

**Priority / type / status:** P1 / product semantics / unconfirmed assumption in the proposal.

**Section:** 2.5 and 1.2.

**Description:** An owner writes `this Saturday` on Monday and schedules the post for the following Monday. The publish date tells the model when the audience reads it, but not which Saturday the owner originally intended. Instant posts have no structured event start to resolve that ambiguity.

**Rationale / impact:** The model can confidently shift the intended event by a week. Supplying a date anchor improves context but cannot verify the underlying fact.

**Recommended action:** State a supported policy: preserve ambiguous owner prose with a review warning, or require an explicit event date before validating it. Prefer a short clarification in the editor when needed, rather than inventing a date. Do not claim that all free-text temporal wording is verified by this feature.

**Open-question handling:** D2.

### R10. Calendar-day drift misses important same-day and automatic delays

**Priority / type / status:** P1 / publishing lifecycle / confirmed coverage gap.

**Section:** 2.6, 3.1, 3.2 and scope.

**Description and evidence:** Same-day moves can cross an event start or invalidate `in two hours` and `happening now`. Automatic retries in `src/lib/publishing/handler.ts:256` are outside the proposed manual-retry hook. Tournament publish-now changes `scheduled_for` in `src/app/actions/tournament.ts:695` but is missing from the proposed changes. An unmodified job delayed overnight never invokes reschedule.

**Rationale / impact:** The core stale-caption risk remains on paths already identified by the spec. Labels based on the stored schedule can also be stale after delayed delivery, so an updated image is not guaranteed.

**Recommended action:** Define generated, intended and actual delivery instants separately. Cover approve-now, manual and automatic retry, tournament publish-now and delayed queue delivery, or explicitly limit the claim of Phase 3. Prefer one pure evaluator invoked before the provider side effect; do not auto-regenerate approved copy during delivery. Define same-day thresholds and expired-event behaviour.

**Open-question handling:** D3 governs intervention on uncertain drift; exact confirmed mismatches should have a defined outcome.

### R11. Regeneration is a new user journey, not just a button

**Priority / type / status:** P1 / UX, failure handling and concurrency / confirmed missing requirements.

**Section:** 3.1 and file list.

**Description and evidence:** `post-drawer.tsx:398` currently saves schedules and displays success or error. The proposed one-click regeneration needs a source brief, destination-date context, selected platform/body, draft preview, save action and approval behaviour. `ai-generate.ts` writes `body_draft`; this alone does not replace the publishable variant.

**Rationale / impact:** Regeneration can overwrite manual changes, leave the published body unchanged, or race an already queued job. A failed or slow model call can leave the owner unsure what will publish.

**Recommended action:** Define preview then accept, preserve manual edits until acceptance, offer manual correction, retain the previous body on failure, and update the body and its temporal metadata together. Specify duplicate-click handling, stale-revision rejection, authorisation, rate limits and missing-brief fallback. Give keyboard focus, labelled controls, announced errors and a persistent warning location explicit acceptance checks. Add the drawer, action, types and tests to the file list.

**Open-question handling:** No additional decision required; this is the recommended minimal reviewable journey.

### R12. Missing and boundary dates lack defined outcomes

**Priority / type / status:** P2 / edge cases / confirmed requirements gap.

**Section:** 1.1, 1.3 and test matrix.

**Description:** The generic day matrix does not specify date-only events, invalid ISO input, unavailable time, promotion end before start, leap day, year rollover, DST nonexistent or repeated local times, overnight events, events in progress, or the weekly occurrence selected once today's start time has passed. `formatEventDateLong` intentionally omits the year. Event timing currently has a three-hour live/recap threshold.

**Rationale / impact:** Calendar-day correctness does not establish time-of-day correctness. Missing data may become misleading urgency or `Invalid DateTime` text.

**Recommended action:** Define validation failures and conservative unknown states. Include years in machine context and use them in visible wording when needed for disambiguation. Specify event-in-progress semantics without assuming an end time. Cover recurrence occurrence selection and use calendar arithmetic across DST, rather than fixed 24-hour differences.

**Open-question handling:** None; preserve documented current semantics where suitable and make deviations explicit.

### R13. Absolute-date reconciliation needs bounded mutation rules

**Priority / type / status:** P2 / content integrity / confirmed specification ambiguity.

**Section:** 2.1, 2.2 and format tests.

**Description:** `Require the absolute date at least once` and `append or verify ... once` do not distinguish at least one from exactly one. The algorithm does not identify which event a matched relative phrase describes, where to append, how to avoid duplicates, or whether user-authored text may be rewritten.

**Rationale / impact:** It can correct an unrelated sentence, repeat dates, remove intended meaning or exceed the final platform length. Appending after word limiting can invalidate otherwise accepted copy.

**Recommended action:** Specify at least one date for the primary structured event, preserve unrelated claims, make reconciliation idempotent, and validate length after all mutations, signatures and CTAs. Prefer review warnings over uncertain rewriting. Define the behaviour of hashtags, abbreviated weekdays, punctuation, quoted phrases and multiple events.

**Open-question handling:** D1 controls style; no additional product decision is needed for conservative mutation.

### R14. The deployment impact and rollback description are inaccurate

**Priority / type / status:** P1 / delivery and compatibility / confirmed contradiction.

**Section:** 4.

**Description:** Phase 1 is described as changing only model instructions, but 1.5 changes approval and reschedule validation and 1.4 changes post-processing. Existing scheduled copy can encounter new rules without regeneration. A revert does not undo generated captions, accepted regeneration or jobs stopped by a new check.

**Rationale / impact:** The release can surprise operators and leave queued or failed work requiring recovery. New JSON metadata is persisted state even without a schema migration.

**Recommended action:** Separate prompt, mutation, advisory and blocking rollout effects. Specify compatibility with missing metadata, how to disable enforcement independently, and how to identify and recover affected jobs without silently rewriting approved posts. Include a read-only inventory before enforcement and an explicit go/no-go gate. If edge-worker hooks are added, include their separate deployment and rollback. Do not promise a flag without deciding how it is configured and tested.

**Open-question handling:** D3; no production action is authorised by this review.

### R15. Drift based on token presence will create noise

**Priority / type / status:** P2 / monitoring and product quality / confirmed design limitation.

**Section:** 3.1 and warning-first rollout.

**Description:** An absolute `Saturday 19th September` remains valid after moving a post, but the proposed weekday trigger warns anyway. `Book today` often remains valid. Conversely `this evening`, `later`, `in 48 hours`, `tomorrow's`, abbreviations and spelled-out countdowns are not clearly covered. The spec requires a known false-positive rate but defines neither measurement nor a release threshold.

**Rationale / impact:** Excess warnings train owners to ignore genuine drift. Keyword presence alone must not be represented as a confirmed error.

**Recommended action:** Separate confirmed mismatch, possible drift and no temporal risk. Record structured reason codes, evaluator version and resolution outcomes without logging full captions or prompts. Define an owner, observation period and agreed threshold before introducing blocks; include unknown-baseline frequency, warning frequency, correction outcomes and publishing failures. These are release criteria to set, not invented numerical targets.

**Open-question handling:** D3.

### R16. Endpoint removal needs evidence beyond absence of internal callers

**Priority / type / status:** P2 / dependency and scope / unconfirmed assumption.

**Section:** 1.6 and 2.9.

**Description and evidence:** The lack of an internal call does not prove a public route has no clients. `tests/api/generate-stream-route.test.ts` directly exercises the route. The current draft offers deletion or convergence without a decision or a dependency inventory.

**Rationale / impact:** Deletion can break external clients and expands a date-correctness release into API retirement. Tests and imports will also need treatment.

**Recommended action:** Default to sharing the temporal implementation while retaining the route. Consider retirement separately after usage evidence and explicit authorisation. Include service callers, route tests and any response-compatibility constraints in the change inventory.

**Open-question handling:** D4.

### R17. The test plan overstates what prompts can prove

**Priority / type / status:** P2 / verification / confirmed acceptance gap.

**Section:** 5.

**Description:** The post-now regression says the output must not contain `today`, yet the required publish line itself may say `today`. Exact overlay equality is not meaningful for null overlays, instant posts or start-versus-end promotion claims. Existing tests can pass while the weekday normaliser destroys copy, as the probe demonstrates.

**Rationale / impact:** Developers can implement brittle assertions that either fail correct output or approve incorrect final copy. Model compliance is not guaranteed by a correct prompt.

**Recommended action:** Specify assertions per field and claim: the event must not be described as happening today when it is eleven days away, while the publish anchor may say today. Test frozen-clock facts, final processed bodies, full generation-to-save provenance, proposed-date preflight, warning severity, regeneration failure, retry and concurrent edits. Add manual-edit and story-empty-body fixtures. Use mocked model responses for deterministic acceptance; any later live quality evaluation needs a bounded sample and explicit authorisation. Verify ordinal forms on supported rendered dates, not every string in free-text input.

**Open-question handling:** None.

### R18. Two timezone runs need explicit evidence, not historical claims

**Priority / type / status:** P2 / CI reliability / partially confirmed.

**Section:** 2.10 and 5.

**Description and evidence:** `package.json` omits UTC from `ci:verify`; `.github/workflows/ci.yml:67` invokes only `test:ci`, with London set at workflow level. `vitest.config.ts` uses `process.env.TZ ??= 'Europe/London'`, so the explicit UTC script is honoured. The claim that UTC is never run in practice cannot be established from configuration. Both targeted runs passed in this review.

**Rationale / impact:** Configuration proves a missing automatic gate, not that historic manual runs never occurred. Duplicating every unrelated test can also increase CI duration.

**Recommended action:** Retain the requested two-zone gate, print or assert the effective timezone in each run, and ensure timezone-dependent paths are actually exercised. Measure the additional duration. A targeted temporal suite is an optional future optimisation only after its coverage is established.

**Open-question handling:** None.

### R19. New reads and actions need explicit tenancy and failure contracts

**Priority / type / status:** P2 / security, integration and reliability / missing requirements, not a newly verified exploit.

**Section:** 1.5, 3.1, 3.2 and file list.

**Description:** Drift inspection and drawer regeneration introduce or extend reads of briefs, variants and generation metadata. The proposal does not specify ownership checks, which variant is evaluated, behaviour on read failure, or protection against stale client timing context. Existing preflight helpers load by content ID, making explicit scoping especially important when extending service-role paths.

**Rationale / impact:** Validation must apply to the body that will actually publish for the active brand and platform. A failed metadata read must not be silently interpreted as no drift.

**Recommended action:** Scope new service-role reads and writes by account, derive authoritative timing server-side, validate metadata shape and select the publishable variant deterministically. Test cross-account access and failed reads. Keep evaluation pure and local, without a model or external call per queue attempt. Batch metadata loads where appropriate; regeneration should occur only on a deliberate action and reuse existing rate limits. Do not add caption or prompt logging to measure warnings.

**Open-question handling:** None.

### R20. The scope and developer handover need a complete dependency map

**Priority / type / status:** P2 / delivery planning / confirmed omission.

**Section:** Header, 6 and phase dependencies.

**Description:** The headline scope and file table omit essential supporting work already implied by the proposal: batch-save provenance, generation action parameters, postprocess options, planner UI and data types, approval callers and lifecycle checks. `postprocessCopy` currently receives an event start but no effective publish reference in `ai-generate.ts:99`; it cannot perform the proposed reconciliation without that contract changing.

**Rationale / impact:** The change is larger than prompt text and pure functions. An estimate or implementation limited to the listed files will omit required behaviour.

**Recommended action:** Produce a dependency map and per-phase acceptance checklist before coding. Update the affected-file inventory after tracing final body storage and all temporal consumers. Keep schema changes conditional on the chosen data contract, rather than treating no migration as proof no data work exists. Follow the repository's spec, plan and CI gates for implementation.

**Open-question handling:** None.

### R21. Avoid additional machinery that does not improve correctness

**Priority / type / status:** P3 / simplification / optional improvement.

**Section:** 1.3, 1.6 and 2.9.

**Description:** Source-text parity checks, endpoint deletion and exhaustive token blacklists are not required to fix post-now framing. Long lists of forbidden words can themselves confuse generation or penalise unrelated claims.

**Rationale / impact:** These additions increase maintenance and review scope without establishing temporal truth.

**Recommended action:** Prefer one structured fact builder, a short positive instruction for the primary event, behavioural parity fixtures and a conservative mismatch evaluator. Retain the edge duplication as agreed. Keep optional style changes and API retirement separate from the initial correctness release.

**Open-question handling:** D4 covers retirement; other simplifications are technical recommendations.

### R22. The style-change rationale credits a protection that already exists

**Priority / type / status:** P2 / evidence and regression coverage / confirmed code discrepancy.

**Section:** 2.1 rationale and 1.3.

**Description and evidence:** `src/lib/ai/prompts.ts:610` already deliberately excludes `context.proximityLabel` from the prompt. Phase 1.3 therefore does not newly remove direct overlay-label injection, as the rationale suggests.

**Rationale / impact:** Relaxing the existing formatting rule needs its own evidence. The stated mechanism does not establish that abbreviated uppercase date leakage can no longer occur.

**Recommended action:** Correct the rationale, preserve the existing exclusion and retain explicit uppercase and abbreviated-date regression cases when allowing natural relative phrasing. Do not infer a guaranteed model behaviour from removal of an input that is already excluded.

**Open-question handling:** D1 governs the style change.

## Specific wording changes to consider

These are replacement suggestions for individual claims, not a rewrite of the original document.

1. Replace the claim that persisted generation data is already sufficient with: **"Each final scheduled body must retain the effective publish instant and temporal facts used to generate it. The current batch-save path requires explicit propagation of this metadata. Missing metadata is an unknown baseline."**
2. Replace the weekday-set validation rule with: **"Block only supported, unambiguous temporal claims that contradict structured facts. Do not reject or rewrite a weekday merely because it is absent from the primary event context. Ambiguous claims receive an advisory review warning."**
3. Replace universal caption-overlay vocabulary equality with: **"Caption instructions and overlays derive from the same temporal facts. Their claims must not contradict each other; their text need not match, and an absent overlay is valid."**
4. Replace the Phase 1 deployment claim with: **"Prompt changes affect subsequent generation. Validation changes also affect existing copy when it is next checked. Rollback must account for generated copy, saved metadata and jobs affected by enforcement."**
5. Replace "UTC is never executed" with: **"UTC is not currently enforced by ci:verify or the checked-in GitHub Actions test job."**

## Recommended delivery sequence

1. Resolve D1 to D4 in chat and amend the affected requirements. Establish the per-body provenance contract and a claim-specific acceptance table first.
2. Deliver the post-now reference correction and contradiction removal with current house style. Pass the same reference through generation, preview and batch persistence. Preserve old records with an explicit unknown-baseline state.
3. Correct both lint and destructive normalisation. Prove final-body behaviour, not just prompt strings, then release advisory drift with complete reschedule and regeneration journeys.
4. Add agreed delivery/retry coverage and observation criteria. Enable stronger enforcement only after the acceptance and operational gates are met.
5. Release any approved natural-language style change once those checks support it. Keep API retirement separate.

For implementation, require the repository's full `ci:verify` gate plus the explicit UTC gate, action integration tests and the actual wizard-to-planner journey in the browser. Check both platforms and feed/story placement. Use a preview deployment for verification and record its deployment ID before any claim that the change is live. Publishing real posts, external model evaluation, production data writes and deployment need separate authorisation.

## Overall readiness and remaining decisions

**Readiness:** the problem statement is useful and several symptoms are reproducible locally, but the complete three-phase proposal is not implementation-ready. No estimate should assume it is solely a prompt change.

**Key required changes:** reliable per-body provenance; a claim-aware and conservative lint contract; correction of the separate weekday-removal path; a single effective clock; explicit warning severity; validation against the proposed destination; an implementable regeneration journey; and accurate rollout and rollback effects.

**Unresolved decision dependencies:** D1 house style, D2 ambiguous free-text treatment, D3 warning and enforcement policy, D4 legacy endpoint retention. The actual questions are in the accompanying chat. No decision is recorded as accepted here.

**Major risks:** stale captions escaping on automatic delivery paths, legitimate posts being blocked or altered, missing provenance making drift undetectable, and regeneration changing approved content without a clear acceptance step. The recommended simplifications reduce these risks without requiring a general-purpose language parser.

**Review status:** report delivered locally only. The original pasted specification, existing repository specification, existing `tasks/todo.md`, application code, tests, schema and deployment state were deliberately left unchanged. No migration was created or applied. No implementation or production verification is claimed.
