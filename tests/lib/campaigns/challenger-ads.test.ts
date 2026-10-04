import { describe, expect, it } from 'vitest';

import { buildAdUtmContentKey } from '@/lib/campaigns/ad-attribution';
import {
  ACTIVATE_REQUIRED_CONFIRMATIONS,
  APPLY_REQUIRED_CONFIRMATIONS,
  buildChallengerAdSpecs,
  buildChallengerKeys,
  CHALLENGER_AD_NAME,
  CHALLENGER_ANGLE,
  CHALLENGER_COPY,
  CHALLENGER_DESCRIPTION_MAX,
  CHALLENGER_HEADLINE_MAX,
  CHALLENGER_PRIMARY_TEXT_MAX,
  checkAccountHeadroom,
  compareChallengerReadBack,
  decideReconciliation,
  detectChallengerStage,
  findSnapshotVariants,
  findVariantProblem,
  isFlightEnded,
  MANUAL_CHECKS,
  mergeChallengerVariant,
  parseConfirmed,
  redactSecrets,
  refuseManagementWrites,
  refuseMetaWrites,
  refuseSupabaseWrites,
  resolveParentLink,
  selectChallengerVariant,
  WEEKDAY_ACCOUNT_ID,
  WEEKDAY_CAMPAIGNS,
  WEEKDAY_CAMPAIGN_LEVEL_SHORT_CODES,
  type VariantExpectation,
} from '@/lib/campaigns/challenger-ads';
import { findRewriteCopyProblems } from '@/lib/campaigns/rewrite-copy';
import type { ManagementMetaAdsLinkVariant } from '@/lib/management-app/client';
import { RECORDED_CREATIVE_FEATURES, type MetaAdLaunchReadBack } from '@/lib/meta/marketing';

const KEY = 'ad__weekday_lunch_a_cod_and_chips__evergreen_test__venue_photo__walk_in__evergreen_test_walk_in_var_4';
const LANDING = 'https://www.the-anchor.pub/lunch-and-dinner';

function variant(overrides: Partial<ManagementMetaAdsLinkVariant> = {}): ManagementMetaAdsLinkVariant {
  return {
    shortUrl: 'https://l.the-anchor.pub/w4lk01',
    shortCode: 'w4lk01',
    destinationUrl: `${LANDING}?utm_campaign=weekday_lunch_a_cod_and_chips&utm_content=meta_ads_main`,
    utmDestinationUrl: `${LANDING}?utm_source=facebook&utm_medium=paid_social&utm_campaign=weekday_lunch_a_cod_and_chips&utm_content=${KEY}`,
    utmContent: KEY,
    parentShortCode: '0ai0j0',
    alreadyExists: false,
    ...overrides,
  };
}

const expectation: VariantExpectation = {
  utmContentKey: KEY,
  parentShortCode: '0ai0j0',
  utmCampaign: 'weekday_lunch_a_cod_and_chips',
  reservedShortCodes: [...WEEKDAY_CAMPAIGN_LEVEL_SHORT_CODES, 'jbozdk', 'qx97ww', '56hzut'],
};

describe('the four challenger ad specs', () => {
  const specs = buildChallengerAdSpecs();

  it('builds one spec per campaign, in the runbook order, with the runbook ids', () => {
    expect(specs.map((spec) => spec.campaign.label)).toEqual(['Lunch A', 'Lunch B', 'Dinner A', 'Dinner B']);
    expect(specs.map((spec) => spec.campaign.campaignId)).toEqual([
      'f80e55db-2b89-4672-809e-57d3253e15e4',
      '52bd9d01-41e0-4ba0-9442-e7f5224604b4',
      'ed08ddeb-a1a9-4ad4-b7aa-704c64ab1f54',
      '86400ca6-ac67-4d05-a1cd-2c7cc7634bc9',
    ]);
    expect(specs.map((spec) => spec.campaign.metaAdSetId)).toEqual([
      '120246019242330609',
      '120246019310340609',
      '120246019370370609',
      '120246019422650609',
    ]);
    expect(WEEKDAY_ACCOUNT_ID).toBe('91fda684-2801-4abb-980e-f42cec017cef');
  });

  it('holds three originals per campaign, 12 in all, plus the one paused rewrite on Lunch A', () => {
    const originals = WEEKDAY_CAMPAIGNS.flatMap((campaign) => campaign.originalMetaAdIds);
    expect(originals).toHaveLength(12);
    expect(new Set(originals).size).toBe(12);
    expect(WEEKDAY_CAMPAIGNS.flatMap((campaign) => campaign.otherKnownMetaAdIds)).toEqual(['120246219010320609']);
    expect(new Set(WEEKDAY_CAMPAIGNS.flatMap((campaign) => campaign.originalShortCodes)).size).toBe(12);
  });

  it('names every challenger the same and keeps the Book now button', () => {
    for (const spec of specs) {
      expect(spec.name).toBe('Evergreen Test | Walk in | Var 4');
      expect(spec.angle).toBe('Walk in');
      expect(spec.cta).toBe('BOOK_NOW');
    }
  });

  it('uses the exact copy from the spec, identical in the A and B campaign of each service', () => {
    expect(CHALLENGER_COPY.lunch).toEqual({
      headline: 'Lunch, no booking needed, Tue to Fri',
      primaryText:
        'Just turn up. We serve lunch Tuesday to Friday, 12pm to 3pm, with snack pots at £9 and wraps at £10. Free on-site parking and dogs welcome, in Stanwell Moor.',
      description: 'Walk in 12pm to 3pm',
    });
    expect(CHALLENGER_COPY.dinner).toEqual({
      headline: 'Dinner Tue to Fri, just walk in from 4pm',
      primaryText:
        'No need to book. We serve dinner 4pm to 9pm, Tuesday to Friday: stone-baked pizzas from £13 and our beef and ale pie with mash at £16. Free on-site parking and dogs welcome.',
      description: 'Kitchen open 4pm to 9pm',
    });

    expect(specs[0]!.copy).toBe(CHALLENGER_COPY.lunch);
    expect(specs[1]!.copy).toBe(CHALLENGER_COPY.lunch);
    expect(specs[2]!.copy).toBe(CHALLENGER_COPY.dinner);
    expect(specs[3]!.copy).toBe(CHALLENGER_COPY.dinner);
  });

  it('keeps every field within its limit: headline 40, primary text 300, description 25', () => {
    expect([CHALLENGER_HEADLINE_MAX, CHALLENGER_PRIMARY_TEXT_MAX, CHALLENGER_DESCRIPTION_MAX]).toEqual([40, 300, 25]);
    for (const copy of Object.values(CHALLENGER_COPY)) {
      expect(copy.headline.length).toBeLessThanOrEqual(40);
      expect(copy.primaryText.length).toBeLessThanOrEqual(300);
      expect(copy.description.length).toBeLessThanOrEqual(25);
    }
  });

  it('matches the character counts the spec records', () => {
    expect(CHALLENGER_COPY.lunch.headline).toHaveLength(36);
    expect(CHALLENGER_COPY.lunch.primaryText).toHaveLength(157);
    expect(CHALLENGER_COPY.lunch.description).toHaveLength(19);
    expect(CHALLENGER_COPY.dinner.headline).toHaveLength(40);
    expect(CHALLENGER_COPY.dinner.primaryText).toHaveLength(173);
    expect(CHALLENGER_COPY.dinner.description).toHaveLength(23);
  });

  it('never says today or tonight (D15) and passes the public-copy rules', () => {
    for (const spec of specs) {
      const text = `${spec.copy.headline} ${spec.copy.primaryText} ${spec.copy.description}`.toLowerCase();
      expect(text).not.toMatch(/\btoday\b|\btonight\b/);
      expect(findRewriteCopyProblems(spec.copy, { campaignName: `Weekday ${spec.campaign.label} (cod and chips)` })).toEqual([]);
    }
  });
});

describe('buildChallengerKeys', () => {
  const parts = { campaignName: 'Weekday Lunch', adSetName: 'Evergreen Test', creativeFormat: 'venue_photo' };
  const baseKey = buildAdUtmContentKey({ ...parts, adName: CHALLENGER_AD_NAME, angle: CHALLENGER_ANGLE });

  it('builds the key from the campaign, ad set, format, angle and challenger name', () => {
    const keys = buildChallengerKeys({ ...parts, takenKeys: [] });

    expect(keys.utmContentKey).toBe(baseKey);
    expect(keys.utmContentKey).toContain('walk_in');
    expect(keys.reused).toBe(false);
    expect(keys.creativeVariantKey).toBeTruthy();
  });

  it('suffixes a key that would collide with a key in another Weekday campaign', () => {
    // Lunch A took the base key; Lunch B, built from the same names, must not share it.
    const lunchA = buildChallengerKeys({ ...parts, takenKeys: [] });
    const lunchB = buildChallengerKeys({ ...parts, takenKeys: ['some_original_key', lunchA.utmContentKey] });

    expect(lunchB.utmContentKey).not.toBe(lunchA.utmContentKey);
    expect(lunchB.utmContentKey).toBe(`${baseKey}__2`);
  });

  it('treats a taken key as taken whatever its letter case', () => {
    const keys = buildChallengerKeys({ ...parts, takenKeys: [baseKey.toUpperCase()] });
    expect(keys.utmContentKey).toBe(`${baseKey}__2`);
  });

  it('reuses a saved key as it stands and never builds it again', () => {
    const keys = buildChallengerKeys({
      ...parts,
      // Different names now: a rebuilt key would differ, and the saved one is also "taken".
      campaignName: 'Renamed since',
      savedRow: { utm_content_key: 'saved_key_from_the_first_run', creative_variant_key: 'saved_variant' },
      takenKeys: ['saved_key_from_the_first_run'],
    });

    expect(keys).toEqual({
      utmContentKey: 'saved_key_from_the_first_run',
      creativeVariantKey: 'saved_variant',
      reused: true,
    });
  });
});

describe('selectChallengerVariant', () => {
  it('selects the one entry carrying the saved key, never the top-level parent link', () => {
    const other = variant({ utmContent: 'some_other_key', shortCode: 'jbozdk', shortUrl: 'https://l.the-anchor.pub/jbozdk' });

    const selection = selectChallengerVariant([other, variant()], expectation);

    expect(selection).toEqual({ ok: true, variant: variant() });
  });

  it('accepts alreadyExists on a retry as success', () => {
    const selection = selectChallengerVariant([variant({ alreadyExists: true })], { ...expectation, savedShortCode: 'w4lk01' });
    expect(selection.ok).toBe(true);
  });

  it('fails safely on a parent-only response', () => {
    expect(selectChallengerVariant([], expectation)).toEqual({
      ok: false,
      reason: 'the response held the parent link only, with no per-ad link',
    });
    expect(selectChallengerVariant(undefined, expectation).ok).toBe(false);
  });

  it('fails safely when no entry carries the saved key', () => {
    const selection = selectChallengerVariant([variant({ utmContent: 'another_key' })], expectation);
    expect(selection).toEqual({ ok: false, reason: 'no per-ad link in the response carries the saved key' });
  });

  it('fails safely when more than one entry carries the saved key', () => {
    const selection = selectChallengerVariant([variant(), variant({ shortCode: 'w4lk02', shortUrl: 'https://l.the-anchor.pub/w4lk02' })], expectation);
    expect(selection).toEqual({ ok: false, reason: 'more than one per-ad link in the response carries the saved key' });
  });

  it('fails when a retry returns a different code from the one already saved', () => {
    const selection = selectChallengerVariant([variant({ alreadyExists: true })], { ...expectation, savedShortCode: 'w4lk09' });
    expect(selection.ok).toBe(false);
  });

  it.each([
    ['the wrong parent', variant({ parentShortCode: 'eff8sa' })],
    ['the campaign-level code as its own', variant({ shortCode: '0ai0j0', shortUrl: 'https://l.the-anchor.pub/0ai0j0' })],
    ['a code an original ad already uses', variant({ shortCode: 'jbozdk', shortUrl: 'https://l.the-anchor.pub/jbozdk' })],
    ['the wrong host', variant({ shortUrl: 'https://vip-club.uk/w4lk01' })],
    ['http rather than https', variant({ shortUrl: 'http://l.the-anchor.pub/w4lk01' })],
    ['an address that does not match its code', variant({ shortUrl: 'https://l.the-anchor.pub/other1' })],
    ['the wrong landing path', variant({ utmDestinationUrl: `https://www.the-anchor.pub/book-table?utm_campaign=weekday_lunch_a_cod_and_chips&utm_content=${KEY}` })],
    ['the wrong landing host', variant({ utmDestinationUrl: `https://the-anchor.example/lunch-and-dinner?utm_campaign=weekday_lunch_a_cod_and_chips&utm_content=${KEY}` })],
    ['the wrong utm_campaign', variant({ utmDestinationUrl: `${LANDING}?utm_campaign=weekday_lunch_b_spicy_chicken_stack&utm_content=${KEY}` })],
    ['a missing utm_campaign', variant({ utmDestinationUrl: `${LANDING}?utm_content=${KEY}` })],
    ['the wrong utm_content', variant({ utmDestinationUrl: `${LANDING}?utm_campaign=weekday_lunch_a_cod_and_chips&utm_content=meta_ads_main` })],
    ['a destination that is not an address', variant({ utmDestinationUrl: 'not a link' })],
    ['no short code', variant({ shortCode: '' })],
  ])('fails safely on %s', (_label, bad) => {
    const selection = selectChallengerVariant([bad], expectation);

    expect(selection.ok).toBe(false);
    expect(findVariantProblem(bad, expectation)).toBeTruthy();
  });

  it('finds nothing wrong with a sound link', () => {
    expect(findVariantProblem(variant(), expectation)).toBeNull();
  });
});

describe('compareChallengerReadBack', () => {
  const allOptedOut = () => Object.fromEntries(RECORDED_CREATIVE_FEATURES.map((feature) => [feature, { enroll_status: 'OPT_OUT' }]));
  const link = 'https://l.the-anchor.pub/w4lk01';

  function readBack(overrides: Partial<MetaAdLaunchReadBack['creative']> = {}, ad: Partial<MetaAdLaunchReadBack> = {}): MetaAdLaunchReadBack {
    return {
      adId: 'ad-1',
      name: CHALLENGER_AD_NAME,
      adSetId: '120246019242330609',
      configuredStatus: 'PAUSED',
      effectiveStatus: 'PAUSED',
      reviewFeedback: null,
      ...ad,
      creative: {
        id: 'creative-1',
        name: CHALLENGER_AD_NAME,
        pageId: '628953850871830',
        link,
        message: CHALLENGER_COPY.lunch.primaryText,
        headline: CHALLENGER_COPY.lunch.headline,
        description: CHALLENGER_COPY.lunch.description,
        // The app sends BOOK_NOW; Meta returns BOOK_TRAVEL.
        callToActionType: 'BOOK_TRAVEL',
        callToActionLink: link,
        creativeFeaturesSpec: allOptedOut(),
        ...overrides,
      },
    };
  }

  function compare(value: MetaAdLaunchReadBack, expectedStatus: 'ACTIVE' | 'PAUSED' = 'PAUSED') {
    return compareChallengerReadBack({
      readBack: value,
      copy: CHALLENGER_COPY.lunch,
      expectedLink: link,
      campaignLevelShortCode: '0ai0j0',
      expectedStatus,
      expectedAdSetId: '120246019242330609',
      expectedPageId: '628953850871830',
    });
  }

  it('passes every check for a sound, paused challenger, with the button normalised', () => {
    const checks = compare(readBack());
    expect(Object.fromEntries(Object.entries(checks).map(([name, check]) => [name, check.result]))).toEqual({
      identity: 'pass',
      copy: 'pass',
      'button and links': 'pass',
      'own link': 'pass',
      enhancements: 'pass',
      review: 'pass',
    });
  });

  it('fails enhancements on any OPT_IN', () => {
    const spec = { ...allOptedOut(), video_filtering: { enroll_status: 'OPT_IN' } };
    expect(compare(readBack({ creativeFeaturesSpec: spec })).enhancements.result).toBe('fail');
  });

  it('reports enhancements as unverified, never a pass, when missing, empty or incomplete', () => {
    expect(compare(readBack({ creativeFeaturesSpec: null })).enhancements.result).toBe('unverified');
    expect(compare(readBack({ creativeFeaturesSpec: {} })).enhancements.result).toBe('unverified');

    const incomplete: Record<string, unknown> = allOptedOut();
    delete incomplete.image_enhancement;
    expect(compare(readBack({ creativeFeaturesSpec: incomplete })).enhancements.result).toBe('unverified');
  });

  it('fails enhancements on an unknown value', () => {
    const spec = { ...allOptedOut(), image_enhancement: { enroll_status: 'SOMETHING_NEW' } };
    expect(compare(readBack({ creativeFeaturesSpec: spec })).enhancements.result).toBe('fail');
  });

  it('fails when the creative link is the campaign-level link', () => {
    const checks = compare(readBack({ link: 'https://l.the-anchor.pub/0ai0j0' }));

    expect(checks['own link'].result).toBe('fail');
    expect(checks['button and links'].result).toBe('fail');
  });

  it('fails when only the button link is the campaign-level link', () => {
    const checks = compare(readBack({ callToActionLink: 'https://l.the-anchor.pub/0ai0j0' }));

    expect(checks['own link'].result).toBe('fail');
    expect(checks['button and links'].result).toBe('fail');
  });

  it('fails a link that is not a short link at all', () => {
    expect(compare(readBack({ link: `${LANDING}?utm_content=x` }))['own link'].result).toBe('fail');
    expect(compare(readBack({ link: null }))['own link'].result).toBe('fail');
  });

  it('fails a different button, and passes BOOK_NOW returned unnormalised', () => {
    expect(compare(readBack({ callToActionType: 'LEARN_MORE' }))['button and links'].result).toBe('fail');
    expect(compare(readBack({ callToActionType: 'BOOK_NOW' }))['button and links'].result).toBe('pass');
  });

  it('fails copy that differs by a single character', () => {
    expect(compare(readBack({ headline: 'Lunch, no booking needed, Tue to Fri!' })).copy.result).toBe('fail');
    expect(compare(readBack({ message: CHALLENGER_COPY.dinner.primaryText })).copy.result).toBe('fail');
    expect(compare(readBack({ description: null })).copy.result).toBe('fail');
  });

  it('fails identity for another name, ad set or Page', () => {
    expect(compare(readBack({}, { name: 'Evergreen Test | Now serving lunch | Var 1' })).identity.result).toBe('fail');
    expect(compare(readBack({}, { adSetId: '120246019310340609' })).identity.result).toBe('fail');
    expect(compare(readBack({ pageId: '111' })).identity.result).toBe('fail');
  });

  it('reports review as pending after activation, and fail on rejection', () => {
    expect(compare(readBack({}, { configuredStatus: 'ACTIVE', effectiveStatus: 'PENDING_REVIEW' }), 'ACTIVE').review.result).toBe('pending');
    expect(compare(readBack({}, { configuredStatus: 'ACTIVE', effectiveStatus: 'DISAPPROVED' }), 'ACTIVE').review.result).toBe('fail');
    expect(compare(readBack({}, { configuredStatus: 'ACTIVE', effectiveStatus: 'ACTIVE' }), 'ACTIVE').review.result).toBe('pass');
  });
});

describe('detectChallengerStage', () => {
  const snapshot = { managementMetaAdVariants: [variant()] };
  const row = { utm_content_key: KEY, meta_creative_id: null, meta_ad_id: null, status: 'DRAFT', meta_status: null };

  it('is S0 with no row', () => {
    expect(detectChallengerStage(null, snapshot)).toBe('S0');
  });

  it('is S1 with a row and no link in the snapshot', () => {
    expect(detectChallengerStage(row, { managementMetaAdVariants: [] })).toBe('S1');
    expect(detectChallengerStage(row, null)).toBe('S1');
    expect(detectChallengerStage(row, { managementMetaAdVariants: [variant({ utmContent: 'another_key' })] })).toBe('S1');
  });

  it('is S2 once the snapshot holds the link for the saved key', () => {
    expect(detectChallengerStage(row, snapshot)).toBe('S2');
  });

  it('is S3 once the creative id is saved', () => {
    expect(detectChallengerStage({ ...row, meta_creative_id: 'creative-1' }, snapshot)).toBe('S3');
  });

  it('is S4 once the ad id is saved and paused', () => {
    expect(detectChallengerStage({ ...row, meta_creative_id: 'creative-1', meta_ad_id: 'ad-1', status: 'PAUSED', meta_status: 'PAUSED' }, snapshot)).toBe('S4');
  });

  it('is S6 only when both statuses are ACTIVE', () => {
    const live = { ...row, meta_creative_id: 'creative-1', meta_ad_id: 'ad-1', status: 'ACTIVE', meta_status: 'ACTIVE' };
    expect(detectChallengerStage(live, snapshot)).toBe('S6');
    expect(detectChallengerStage({ ...live, meta_status: 'PAUSED' }, snapshot)).toBe('S4');
  });
});

describe('decideReconciliation', () => {
  it('may create when Meta holds none', () => {
    expect(decideReconciliation([])).toEqual({ action: 'create' });
  });

  it('adopts exactly one match rather than creating again', () => {
    expect(decideReconciliation([{ id: 'ad-1' }])).toEqual({ action: 'adopt', match: { id: 'ad-1' } });
  });

  it('stops and reports several matches: it never guesses', () => {
    expect(decideReconciliation([{ id: 'ad-1' }, { id: 'ad-2' }])).toEqual({
      action: 'stop',
      matches: [{ id: 'ad-1' }, { id: 'ad-2' }],
    });
  });
});

describe('mergeChallengerVariant', () => {
  const existing = [
    { utmContent: 'original_1', shortCode: 'jbozdk', shortUrl: 'https://l.the-anchor.pub/jbozdk', extra: 'kept' },
    { utm_content: 'original_2', short_code: 'qx97ww' },
    'an odd entry that is not an object',
  ];
  const snapshot = { shortCode: '0ai0j0', sourceType: 'custom_promotion', managementMetaAdVariants: existing };

  it('adds only the one new entry and keeps every existing entry and field untouched', () => {
    const before = structuredClone(snapshot);

    const merged = mergeChallengerVariant(snapshot, variant());

    expect(merged.changed).toBe(true);
    const variants = merged.snapshot.managementMetaAdVariants as unknown[];
    expect(variants).toHaveLength(4);
    expect(variants.slice(0, 3)).toEqual(existing);
    expect(variants[3]).toEqual({
      utmContent: KEY,
      shortUrl: 'https://l.the-anchor.pub/w4lk01',
      shortCode: 'w4lk01',
      destinationUrl: variant().destinationUrl,
      utmDestinationUrl: variant().utmDestinationUrl,
      parentShortCode: '0ai0j0',
      alreadyExists: false,
    });
    expect(merged.snapshot.shortCode).toBe('0ai0j0');
    expect(merged.snapshot.sourceType).toBe('custom_promotion');
    // The input is not altered.
    expect(snapshot).toEqual(before);
  });

  it('starts the list when the snapshot has none', () => {
    expect(mergeChallengerVariant(null, variant()).snapshot.managementMetaAdVariants).toHaveLength(1);
    expect(mergeChallengerVariant({ shortCode: '0ai0j0' }, variant()).snapshot).toMatchObject({ shortCode: '0ai0j0' });
  });

  it('changes nothing when the same link is already there', () => {
    const once = mergeChallengerVariant(snapshot, variant()).snapshot;

    const twice = mergeChallengerVariant(once, variant({ alreadyExists: true }));

    expect(twice.changed).toBe(false);
    expect(twice.snapshot.managementMetaAdVariants).toEqual(once.managementMetaAdVariants);
  });

  it('refuses to replace a different link saved for the same key', () => {
    const once = mergeChallengerVariant(snapshot, variant()).snapshot;
    expect(() => mergeChallengerVariant(once, variant({ shortCode: 'w4lk02', shortUrl: 'https://l.the-anchor.pub/w4lk02' }))).toThrow(/different per-ad link/);
  });

  it('refuses a snapshot whose links are not a list, rather than overwrite it', () => {
    expect(() => mergeChallengerVariant({ managementMetaAdVariants: { odd: true } }, variant())).toThrow(/not understood/);
  });

  it('finds saved entries by key in either naming style', () => {
    expect(findSnapshotVariants(snapshot, 'original_1')).toHaveLength(1);
    expect(findSnapshotVariants(snapshot, 'ORIGINAL_2')[0]?.shortCode).toBe('qx97ww');
    expect(findSnapshotVariants(snapshot, 'missing')).toEqual([]);
    expect(findSnapshotVariants(snapshot, null)).toEqual([]);
  });
});

describe('isFlightEnded', () => {
  it('is still running on the last day, 16 October 2026, in London', () => {
    expect(isFlightEnded(new Date('2026-10-16T12:00:00.000Z'), '2026-10-16')).toBe(false);
    // 23:59 in London (BST is UTC+1, so 22:59 UTC).
    expect(isFlightEnded(new Date('2026-10-16T22:59:00.000Z'), '2026-10-16')).toBe(false);
  });

  it('has ended from 00:00 on 17 October in London, which is still 16 October in UTC', () => {
    // 00:30 on 17 October in London during BST is 23:30 on 16 October in UTC.
    expect(isFlightEnded(new Date('2026-10-16T23:30:00.000Z'), '2026-10-16')).toBe(true);
    expect(isFlightEnded(new Date('2026-10-17T08:00:00.000Z'), '2026-10-16')).toBe(true);
  });

  it('never runs past the runbook date, whatever the row says', () => {
    expect(isFlightEnded(new Date('2026-10-17T08:00:00.000Z'), '2026-10-31')).toBe(true);
    expect(isFlightEnded(new Date('2026-10-17T08:00:00.000Z'), null)).toBe(true);
    expect(isFlightEnded(new Date('2026-10-05T08:00:00.000Z'), null)).toBe(false);
  });

  it('respects an earlier end date on the row', () => {
    expect(isFlightEnded(new Date('2026-10-10T08:00:00.000Z'), '2026-10-09')).toBe(true);
    expect(isFlightEnded(new Date('2026-10-09T08:00:00.000Z'), '2026-10-09')).toBe(false);
  });

  it('reads London dates correctly after the clocks go back on 25 October 2026 (GMT)', () => {
    // In GMT, London and UTC share a date: 00:30 on 1 November is past any October flight.
    expect(isFlightEnded(new Date('2026-11-01T00:30:00.000Z'), '2026-10-16')).toBe(true);
  });
});

describe('checkAccountHeadroom', () => {
  const account = { accountStatus: 1, spendCapMinor: 50_000, amountSpentMinor: 21_000 };

  it('passes when the headroom covers what the four ad sets still have to spend', () => {
    expect(checkAccountHeadroom(account, [7_000, 7_000, 7_000, 7_000])).toEqual({ result: 'pass', reasons: [] });
    expect(checkAccountHeadroom(account, [7_250, 7_250, 7_250, 7_250]).result).toBe('pass');
  });

  it('fails when the headroom is short, and says by how much', () => {
    const check = checkAccountHeadroom(account, [8_000, 8_000, 8_000, 8_000]);

    expect(check.result).toBe('fail');
    expect(check.reasons[0]).toContain('£290.00');
    expect(check.reasons[0]).toContain('£320.00');
  });

  it('fails when the account is not active', () => {
    expect(checkAccountHeadroom({ ...account, accountStatus: 2 }, [0, 0, 0, 0]).result).toBe('fail');
    expect(checkAccountHeadroom({ ...account, accountStatus: null }, [0, 0, 0, 0]).result).toBe('fail');
  });

  it('fails when the spending limit has been removed', () => {
    expect(checkAccountHeadroom({ ...account, spendCapMinor: 0 }, [7_000, 7_000, 7_000, 7_000]).result).toBe('fail');
  });

  it('is unverified, never a pass, when Meta leaves a figure out', () => {
    expect(checkAccountHeadroom({ ...account, spendCapMinor: null }, [7_000, 7_000, 7_000, 7_000]).result).toBe('unverified');
    expect(checkAccountHeadroom({ ...account, amountSpentMinor: null }, [7_000, 7_000, 7_000, 7_000]).result).toBe('unverified');
    expect(checkAccountHeadroom(account, [7_000, null, 7_000, 7_000]).result).toBe('unverified');
  });
});

describe('redactSecrets', () => {
  it('removes known secret values, Meta tokens and token parameters', () => {
    const line = 'failed GET https://graph.facebook.com/v24.0/act_1?access_token=EAAsecretTokenValue1234567890&fields=id with key mgmt-secret-key-123 and https://storage.test/x.png?token=abc.def';

    const redacted = redactSecrets(line, ['mgmt-secret-key-123']);

    expect(redacted).not.toContain('EAAsecretTokenValue1234567890');
    expect(redacted).not.toContain('mgmt-secret-key-123');
    expect(redacted).not.toContain('abc.def');
    expect(redacted).toContain('fields=id');
  });

  it('leaves ordinary text, ids and utm values alone', () => {
    const line = 'S1 row: inserted row-1 with key ad__weekday_lunch__walk_in and utm_content=ad__weekday_lunch__walk_in';
    expect(redactSecrets(line, ['', 'abc'])).toBe(line);
  });
});

describe('the read-only guards handed to --dry-run and --status', () => {
  it('lets database reads through and refuses every kind of write', async () => {
    const reads: string[] = [];
    const real = {
      from: (table: string) => ({
        select: (columns: string) => ({
          eq: async (column: string, value: string) => {
            reads.push(`${table}.${columns} where ${column}=${value}`);
            return { data: [{ id: 'row-1' }], error: null };
          },
        }),
        insert: () => { throw new Error('the real insert ran'); },
        update: () => { throw new Error('the real update ran'); },
        upsert: () => { throw new Error('the real upsert ran'); },
        delete: () => { throw new Error('the real delete ran'); },
      }),
      rpc: () => { throw new Error('the real procedure ran'); },
      storage: { from: () => ({ createSignedUrl: () => { throw new Error('the real storage call ran'); } }) },
    };
    const guarded = refuseSupabaseWrites(real as never);

    await expect(guarded.from('ads').select('id').eq('adset_id', 'adset-1')).resolves.toEqual({ data: [{ id: 'row-1' }], error: null });
    expect(reads).toEqual(['ads.id where adset_id=adset-1']);

    expect(() => guarded.from('ads').insert({})).toThrow(/Refused: insert on ads/);
    expect(() => guarded.from('ads').update({})).toThrow(/Refused: update on ads/);
    expect(() => guarded.from('meta_campaigns').upsert({})).toThrow(/Refused: upsert on meta_campaigns/);
    expect(() => guarded.from('ads').delete()).toThrow(/Refused: delete on ads/);
    expect(() => guarded.rpc('anything')).toThrow(/Refused: a database procedure call/);
    expect(() => guarded.storage.from('media')).toThrow(/Refused: a storage call/);
  });

  it('lets Meta reads through and refuses every Meta write', async () => {
    const calls: string[] = [];
    const note = (name: string) => async () => {
      calls.push(name);
      return undefined as never;
    };
    const guarded = refuseMetaWrites({
      fetchAdAccountSpendStatus: note('fetchAdAccountSpendStatus'),
      fetchAdSetBudgetRemaining: note('fetchAdSetBudgetRemaining'),
      listAdSetAds: note('listAdSetAds'),
      listAdCreativesNamed: note('listAdCreativesNamed'),
      readAdForLaunch: note('readAdForLaunch'),
      readAdCreative: note('readAdCreative'),
      uploadImage: note('uploadImage'),
      createAdCreative: note('createAdCreative'),
      createAd: note('createAd'),
      setObjectStatus: note('setObjectStatus'),
    });

    await guarded.fetchAdAccountSpendStatus('act_1', 't');
    await guarded.fetchAdSetBudgetRemaining('1', 't');
    await guarded.listAdSetAds('1', 't');
    await guarded.listAdCreativesNamed('act_1', 't', 'n');
    await guarded.readAdForLaunch('1', 't');
    await guarded.readAdCreative('1', 't');
    expect(() => guarded.uploadImage('act_1', 't', 'https://example.test/x.png')).toThrow(/Refused: an image upload/);
    expect(() => guarded.createAdCreative({} as never)).toThrow(/Refused: creating a Meta creative/);
    expect(() => guarded.createAd({} as never)).toThrow(/Refused: creating a Meta ad/);
    expect(() => guarded.setObjectStatus('1', 't', 'ACTIVE')).toThrow(/Refused: a Meta status change/);

    expect(calls).toEqual([
      'fetchAdAccountSpendStatus',
      'fetchAdSetBudgetRemaining',
      'listAdSetAds',
      'listAdCreativesNamed',
      'readAdForLaunch',
      'readAdCreative',
    ]);
  });

  it('refuses the short-link request, the only call the management app is ever sent', () => {
    expect(() => refuseManagementWrites().createMetaAdsLink({ baseUrl: 'https://example.test', apiKey: 'k' }, { destinationUrl: 'x', campaignName: 'y' }))
      .toThrow(/Refused: a short-link request/);
  });
});

describe('parseConfirmed', () => {
  it('reads comma-separated and repeated values, without duplicates', () => {
    expect(parseConfirmed(['owner-go-ahead,claims', 'claims', ' previews '])).toEqual(['owner-go-ahead', 'claims', 'previews']);
    expect(parseConfirmed([])).toEqual([]);
  });

  it('refuses a name it does not know', () => {
    expect(() => parseConfirmed(['claims,everything'])).toThrow(/Unknown --confirmed value: everything/);
  });

  it('needs the go-ahead and the price check to create, and every check to activate', () => {
    expect(APPLY_REQUIRED_CONFIRMATIONS).toEqual(['owner-go-ahead', 'claims']);
    expect([...ACTIVATE_REQUIRED_CONFIRMATIONS].sort()).toEqual(Object.keys(MANUAL_CHECKS).sort());
    expect(ACTIVATE_REQUIRED_CONFIRMATIONS).toContain('organic-booking');
  });
});

describe('resolveParentLink', () => {
  it('takes the parent code and destination from the snapshot, as publishing does', () => {
    expect(resolveParentLink(
      { shortCode: '0ai0j0', utmDestinationUrl: `${LANDING}?utm_content=meta_ads_main` },
      'https://l.the-anchor.pub/0ai0j0',
    )).toEqual({ parentShortCode: '0ai0j0', parentDestinationUrl: `${LANDING}?utm_content=meta_ads_main` });
  });

  it('falls back to the paid link, then the campaign link', () => {
    expect(resolveParentLink({ paidCtaUrl: 'https://l.the-anchor.pub/eff8sa' }, 'https://example.test/x').parentShortCode).toBe('eff8sa');
    expect(resolveParentLink(null, 'https://l.the-anchor.pub/HRFOWP')).toEqual({
      parentShortCode: 'hrfowp',
      parentDestinationUrl: 'https://l.the-anchor.pub/HRFOWP',
    });
  });

  it('finds no parent code in a link on an untrusted host', () => {
    expect(resolveParentLink({}, 'https://www.the-anchor.pub/lunch-and-dinner').parentShortCode).toBeNull();
  });
});
