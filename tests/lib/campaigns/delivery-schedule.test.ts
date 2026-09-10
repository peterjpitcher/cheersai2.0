import { DateTime } from 'luxon';
import { describe, expect, it } from 'vitest';

import {
  describeDeliveryDays,
  describeDeliveryHours,
  describeDeliverySchedule,
  describeDeliveryScheduleForCopy,
  describeOffScheduleCopyProblem,
  findOffScheduleCopy,
  findOffScheduleDayTerms,
  isDeliverySchedule,
  listOffScheduleMentions,
  listScheduledDeliveryDates,
  metaAdSetScheduleMatches,
  normaliseDeliverySchedule,
  toMetaAdSetSchedule,
  validateDeliverySchedule,
  type DeliveryScheduleContext,
} from '@/lib/campaigns/delivery-schedule';
import type { MetaAdSetScheduleEntry } from '@/lib/meta/marketing';
import type { DeliverySchedule, RunDay } from '@/types/campaigns';

// The Anchor's weekday food ads (tasks/SPEC-evergreen-delivery-schedule.md).
const TUESDAY_TO_FRIDAY: RunDay[] = ['tuesday', 'wednesday', 'thursday', 'friday'];
const LUNCH: DeliverySchedule = { days: TUESDAY_TO_FRIDAY, startHour: 9, endHour: 14 };
const DINNER: DeliverySchedule = { days: TUESDAY_TO_FRIDAY, startHour: 14, endHour: 20 };

// The real flight: Tuesday 15 September to Friday 9 October 2026, total budget.
const FLIGHT: DeliveryScheduleContext = {
  campaignKind: 'evergreen',
  budgetType: 'LIFETIME',
  startDate: '2026-09-15',
  endDate: '2026-10-09',
};

describe('toMetaAdSetSchedule', () => {
  it('maps lunch to Meta days (Sunday = 0) and minutes, in the ad account time zone', () => {
    expect(toMetaAdSetSchedule(LUNCH)).toEqual([
      { start_minute: 540, end_minute: 840, days: [2, 3, 4, 5], timezone_type: 'ADVERTISER' },
    ]);
  });

  it('maps dinner to 14:00 to 20:00', () => {
    expect(toMetaAdSetSchedule(DINNER)).toEqual([
      { start_minute: 840, end_minute: 1200, days: [2, 3, 4, 5], timezone_type: 'ADVERTISER' },
    ]);
  });

  it('never includes Monday (1) for a Tuesday to Friday schedule', () => {
    expect(toMetaAdSetSchedule(LUNCH)[0]!.days).not.toContain(1);
  });

  it('maps Sunday to 0 and Saturday to 6, sorts the days, and ends at 1440 for midnight', () => {
    expect(toMetaAdSetSchedule({ days: ['saturday', 'monday', 'sunday'], startHour: 0, endHour: 24 })).toEqual([
      { start_minute: 0, end_minute: 1440, days: [0, 1, 6], timezone_type: 'ADVERTISER' },
    ]);
  });
});

describe('validateDeliverySchedule', () => {
  it('accepts no schedule on any campaign, which is the behaviour before schedules existed', () => {
    const eventDaily: DeliveryScheduleContext = { ...FLIGHT, campaignKind: 'event', budgetType: 'DAILY' };
    expect(validateDeliverySchedule(null, eventDaily)).toBeNull();
    expect(validateDeliverySchedule(undefined, eventDaily)).toBeNull();
  });

  it('accepts the real lunch and dinner schedules on the 15 September to 9 October flight', () => {
    expect(validateDeliverySchedule(LUNCH, FLIGHT)).toBeNull();
    expect(validateDeliverySchedule(DINNER, FLIGHT)).toBeNull();
  });

  it('accepts a 24:00 end and a one-day flight on a scheduled day', () => {
    const lateNight: DeliverySchedule = { days: ['friday'], startHour: 18, endHour: 24 };
    expect(validateDeliverySchedule(lateNight, { ...FLIGHT, startDate: '2026-10-09', endDate: '2026-10-09' })).toBeNull();
  });

  it.each<[string, unknown, Partial<DeliveryScheduleContext>, RegExp]>([
    ['an event campaign', LUNCH, { campaignKind: 'event' }, /only available for evergreen campaigns/],
    ['a food_booking campaign', LUNCH, { campaignKind: 'food_booking' }, /only available for evergreen campaigns/],
    ['a daily budget', LUNCH, { budgetType: 'DAILY' }, /need a total budget/],
    ['a missing budget type', LUNCH, { budgetType: null }, /need a total budget/],
    ['a string', 'tuesday', {}, /not valid/],
    ['an array', ['tuesday'], {}, /not valid/],
    ['no days', { ...LUNCH, days: [] }, {}, /at least one delivery day/],
    ['a missing days list', { startHour: 9, endHour: 14 }, {}, /at least one delivery day/],
    ['an unknown day', { ...LUNCH, days: ['tuesday', 'funday'] }, {}, /unknown day/],
    ['a capitalised day', { ...LUNCH, days: ['Tuesday'] }, {}, /unknown day/],
    ['a repeated day', { ...LUNCH, days: ['tuesday', 'tuesday'] }, {}, /only be chosen once/],
    ['half hours', { ...LUNCH, startHour: 9.5 }, {}, /whole hours/],
    ['hours as text', { ...LUNCH, endHour: '14' }, {}, /whole hours/],
    ['a missing end hour', { days: TUESDAY_TO_FRIDAY, startHour: 9 }, {}, /whole hours/],
    ['a start after the end', { ...LUNCH, startHour: 14, endHour: 9 }, {}, /end after it starts/],
    ['a zero-length window', { ...LUNCH, startHour: 9, endHour: 9 }, {}, /end after it starts/],
    ['a negative start', { ...LUNCH, startHour: -1 }, {}, /end after it starts/],
    ['an end past midnight', { ...LUNCH, endHour: 25 }, {}, /end after it starts/],
    ['no end date', LUNCH, { endDate: null }, /Set an end date/],
    ['a malformed start date', LUNCH, { startDate: '15/09/2026' }, /valid campaign start and end dates/],
    ['an impossible date', LUNCH, { endDate: '2026-02-30' }, /valid campaign start and end dates/],
    ['an end before the start', LUNCH, { startDate: '2026-10-09', endDate: '2026-09-15' }, /on or after the start date/],
    ['a flight with no scheduled day', LUNCH, { startDate: '2026-09-19', endDate: '2026-09-21' }, /None of the chosen delivery days/],
  ])('rejects %s', (_label, schedule, overrides, message) => {
    expect(validateDeliverySchedule(schedule, { ...FLIGHT, ...overrides })).toMatch(message);
  });

  it('names the flight dates when no chosen day falls inside it (Saturday to Monday)', () => {
    expect(validateDeliverySchedule(LUNCH, { ...FLIGHT, startDate: '2026-09-19', endDate: '2026-09-21' })).toBe(
      'None of the chosen delivery days fall between 19 September 2026 and 21 September 2026. Choose other days or change the dates.',
    );
  });

  it('checks the campaign rules before the shape, so the most useful message comes first', () => {
    expect(validateDeliverySchedule({ days: [] }, { ...FLIGHT, budgetType: 'DAILY' })).toMatch(/total budget/);
  });
});

describe('listScheduledDeliveryDates', () => {
  it('lists the 16 serving days of the 15 September to 9 October flight, none of them a Monday', () => {
    const dates = listScheduledDeliveryDates(LUNCH, '2026-09-15', '2026-10-09');

    expect(dates).toEqual([
      '2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18',
      '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25',
      '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02',
      '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09',
    ]);
    for (const date of dates) {
      const weekday = DateTime.fromISO(date, { zone: 'Europe/London' }).weekday;
      expect(weekday).toBeGreaterThanOrEqual(2); // Tuesday
      expect(weekday).toBeLessThanOrEqual(5); // Friday
    }
  });

  it('visits each date once across the 25 October 2026 clock change (BST ends that Sunday)', () => {
    expect(listScheduledDeliveryDates(LUNCH, '2026-10-20', '2026-10-30')).toEqual([
      '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23',
      '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30',
    ]);

    // A 24-hour step from BST midnight would land on 25 October twice; calendar steps do not.
    const weekendAndMonday: DeliverySchedule = { days: ['saturday', 'sunday', 'monday'], startHour: 0, endHour: 24 };
    expect(listScheduledDeliveryDates(weekendAndMonday, '2026-10-24', '2026-10-26')).toEqual([
      '2026-10-24', '2026-10-25', '2026-10-26',
    ]);
  });

  it('returns nothing for invalid or reversed dates', () => {
    expect(listScheduledDeliveryDates(LUNCH, 'not-a-date', '2026-10-09')).toEqual([]);
    expect(listScheduledDeliveryDates(LUNCH, '2026-10-09', '2026-09-15')).toEqual([]);
  });
});

describe('a flight across the 25 October 2026 clock change', () => {
  it('is accepted, and the Meta window stays 09:00 to 14:00 in ad account time', () => {
    expect(validateDeliverySchedule(LUNCH, { ...FLIGHT, startDate: '2026-10-20', endDate: '2026-10-30' })).toBeNull();
    expect(toMetaAdSetSchedule(LUNCH)).toEqual([
      { start_minute: 540, end_minute: 840, days: [2, 3, 4, 5], timezone_type: 'ADVERTISER' },
    ]);
  });

  it('is rejected when it only covers the clock-change weekend and the Monday after', () => {
    expect(validateDeliverySchedule(LUNCH, { ...FLIGHT, startDate: '2026-10-24', endDate: '2026-10-26' })).toMatch(
      /None of the chosen delivery days fall between 24 October 2026 and 26 October 2026/,
    );
  });
});

describe('normaliseDeliverySchedule and isDeliverySchedule', () => {
  it('stores days in week order and drops unknown fields', () => {
    const messy = { days: ['friday', 'tuesday', 'thursday', 'wednesday'], startHour: 9, endHour: 14, note: 'x' };
    expect(isDeliverySchedule(messy)).toBe(true);
    expect(normaliseDeliverySchedule(messy as DeliverySchedule)).toEqual(LUNCH);
  });

  it('recognises only well-formed schedules', () => {
    expect(isDeliverySchedule(LUNCH)).toBe(true);
    expect(isDeliverySchedule(null)).toBe(false);
    expect(isDeliverySchedule({})).toBe(false);
    expect(isDeliverySchedule({ ...LUNCH, startHour: 14 })).toBe(false);
  });
});

describe('metaAdSetScheduleMatches', () => {
  const sent = toMetaAdSetSchedule(LUNCH);
  const readBack = (adsetSchedule: MetaAdSetScheduleEntry[], pacingType = ['day_parting']) => ({
    pacingType,
    adsetSchedule,
  });

  it('matches an identical read-back', () => {
    expect(metaAdSetScheduleMatches(sent, readBack(sent))).toBe(true);
  });

  it('matches when Meta splits the window per day or lists the days in another order', () => {
    const perDay = [5, 3, 2, 4].map((day) => ({
      start_minute: 540,
      end_minute: 840,
      days: [day],
      timezone_type: 'advertiser',
    }));
    expect(metaAdSetScheduleMatches(sent, readBack(perDay))).toBe(true);
  });

  it.each<[string, ReturnType<typeof readBack>]>([
    ['no day parting', readBack(sent, [])],
    ['standard pacing', readBack(sent, ['standard'])],
    ['different minutes', readBack([{ ...sent[0]!, end_minute: 900 }])],
    ['an added Monday', readBack([{ ...sent[0]!, days: [1, 2, 3, 4, 5] }])],
    ['a missing Friday', readBack([{ ...sent[0]!, days: [2, 3, 4] }])],
    ['the USER time zone', readBack([{ ...sent[0]!, timezone_type: 'USER' }])],
    ['no time zone type', readBack([{ ...sent[0]!, timezone_type: '' }])],
    ['unreadable minutes', readBack([{ ...sent[0]!, start_minute: Number.NaN }])],
    ['no schedule at all', readBack([])],
  ])('rejects a read-back with %s', (_label, actual) => {
    expect(metaAdSetScheduleMatches(sent, actual)).toBe(false);
  });

  it('never matches when nothing was expected', () => {
    expect(metaAdSetScheduleMatches([], readBack([]))).toBe(false);
  });
});

describe('describeDeliverySchedule', () => {
  it('describes the lunch and dinner schedules in plain English', () => {
    expect(describeDeliverySchedule(LUNCH)).toBe('Tuesday to Friday, 09:00 to 14:00');
    expect(describeDeliverySchedule(DINNER)).toBe('Tuesday to Friday, 14:00 to 20:00');
  });

  it.each<[RunDay[], string]>([
    [['monday', 'tuesday', 'wednesday', 'thursday', 'friday'], 'Monday to Friday'],
    [['saturday', 'sunday'], 'Saturday and Sunday'],
    [['tuesday', 'thursday', 'saturday'], 'Tuesday, Thursday and Saturday'],
    [['friday', 'monday', 'tuesday', 'wednesday'], 'Monday to Wednesday and Friday'],
    [['wednesday'], 'Wednesday'],
    [['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'], 'every day'],
  ])('describes %j as "%s"', (days, expected) => {
    expect(describeDeliveryDays(days)).toBe(expected);
  });

  it('describes midnight and all-day windows', () => {
    expect(describeDeliveryHours(18, 24)).toBe('18:00 to midnight');
    expect(describeDeliveryHours(0, 9)).toBe('00:00 to 09:00');
    expect(describeDeliveryHours(0, 24)).toBe('all day');
  });
});

describe('findOffScheduleDayTerms (the off_schedule_day copy check)', () => {
  it.each<[string, string[]]>([
    ['Open Monday to Friday for lunch.', ['Monday']],
    ['Not on mondays.', ['mondays']],
    ["Monday's special is back.", ["Monday"]],
    ['Lunch Mon-Fri, 12 to 3.', ['Mon']],
    ['LUNCH MON TO FRI', ['MON']],
    ['Open Sat. and Sun.', ['Sat', 'Sun']],
    ['Book your Sunday roast now.', ['Sunday']],
    ['Tuesday to Saturday, 12 to 3.', ['Saturday']],
    ['Perfect for the weekend.', ['weekend']],
    ['Great for weekends and week-ends.', ['weekends', 'week-ends']],
    ['Serving food every day.', ['every day']],
    ['Your everyday local.', ['everyday']],
    ['Daily specials from £9.', ['Daily']],
    ['Open 7 days a week, seven days a week.', ['7 days a week', 'seven days a week']],
  ])('flags "%s" for a Tuesday to Friday schedule', (text, expected) => {
    expect(findOffScheduleDayTerms(text, LUNCH)).toEqual(expected);
  });

  it('reports each term once, in the order it appears', () => {
    expect(findOffScheduleDayTerms('Weekend lunch, Monday dinner, every day, weekend again, Monday.', LUNCH)).toEqual([
      'Weekend',
      'Monday',
      'every day',
    ]);
  });

  it.each([
    'Lunch now served, Tue to Fri, 12 to 3',
    "We're now serving lunch Tuesday to Friday, 12pm to 3pm. Free on-site parking, and dogs are welcome.",
    'Dinner 4pm to 9pm, Tuesday to Friday',
    'Wed and Thurs are quiz-free, Weds too.',
    'Enjoy the sun terrace after you have sat down.',
    "C'mon down, the Sun's out.",
    'Monster burgers and satisfying sides, weekday favourites.',
    'Fries on the side.',
    'Sunny afternoons in Stanwell Moor.',
  ])('does not flag "%s"', (text) => {
    expect(findOffScheduleDayTerms(text, LUNCH)).toEqual([]);
  });

  it('allows the weekend only when both weekend days are scheduled', () => {
    const weekend: DeliverySchedule = { days: ['saturday', 'sunday'], startHour: 12, endHour: 16 };
    const saturdayOnly: DeliverySchedule = { days: ['saturday'], startHour: 12, endHour: 16 };

    expect(findOffScheduleDayTerms('A proper weekend lunch.', weekend)).toEqual([]);
    expect(findOffScheduleDayTerms('A proper weekend lunch.', saturdayOnly)).toEqual(['weekend']);
    expect(findOffScheduleDayTerms('Saturday and Sunday lunch.', saturdayOnly)).toEqual(['Sunday']);
  });

  it('allows "every day" and "daily" only when all seven days are scheduled', () => {
    const everyDay: DeliverySchedule = {
      days: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'],
      startHour: 12,
      endHour: 15,
    };
    expect(findOffScheduleDayTerms('Lunch every day, daily specials, open weekends.', everyDay)).toEqual([]);
  });
});

describe('findOffScheduleCopy and describeOffScheduleCopyProblem', () => {
  const ad = (name: string, headline: string, primaryText: string, description = 'Book now') => ({
    name,
    headline,
    primary_text: primaryText,
    description,
    cta: 'BOOK_NOW' as const,
    creative_brief: 'Dish photo',
    angle: name,
  });
  const payload = {
    ad_sets: [
      {
        name: 'Evergreen Test',
        phase_label: 'Evergreen Test',
        phase_start: '2026-09-15',
        phase_end: '2026-10-09',
        audience_description: 'Locals',
        targeting: { age_min: 18, age_max: 65, geo_locations: { countries: ['GB'] } },
        placements: 'AUTO' as const,
        optimisation_goal: 'LINK_CLICKS',
        bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
        ads: [
          ad('Burger lunch', 'Lunch now served, Tue to Fri, 12 to 3', 'Burgers from £11, Tuesday to Friday.'),
          ad('Wrap lunch', 'Wraps £10, served Mon to Fri', 'A fish finger wrap is £10.'),
          ad('Pie lunch', 'Pies from £15', 'A proper pub lunch every day.', 'Weekend treat'),
        ],
      },
    ],
  };

  it('finds the ads whose headline, primary text or description breaks the schedule', () => {
    expect(findOffScheduleCopy(payload, LUNCH)).toEqual([
      { adSetName: 'Evergreen Test', adName: 'Wrap lunch', terms: ['Mon'] },
      { adSetName: 'Evergreen Test', adName: 'Pie lunch', terms: ['every day', 'Weekend'] },
    ]);
  });

  it('explains which ads to fix, in plain English', () => {
    expect(describeOffScheduleCopyProblem(findOffScheduleCopy(payload, LUNCH), LUNCH)).toBe(
      'This campaign only shows Tuesday to Friday, 09:00 to 14:00, UK time, but some ad copy says otherwise: "Wrap lunch" (Mon) and "Pie lunch" (every day, Weekend). Edit the copy, then save again.',
    );
  });
});

describe('the delivery schedule prompt line', () => {
  it('tells the AI the lunch schedule and what never to mention', () => {
    expect(describeDeliveryScheduleForCopy(LUNCH)).toBe(
      'These ads only show Tuesday to Friday, 09:00 to 14:00; never mention Monday, the weekend, or every day.',
    );
    expect(listOffScheduleMentions(DINNER)).toEqual(['Monday', 'the weekend', 'every day']);
  });

  it('names a single weekend day that is off, and nothing extra for a full week', () => {
    expect(listOffScheduleMentions({ days: ['friday', 'saturday'], startHour: 12, endHour: 15 })).toEqual([
      'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Sunday', 'the weekend', 'every day',
    ]);
    expect(describeDeliveryScheduleForCopy({
      days: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'],
      startHour: 12,
      endHour: 15,
    })).toBe('These ads only show every day, 12:00 to 15:00.');
  });

  it('uses "or" between two items', () => {
    expect(describeDeliveryScheduleForCopy({
      days: ['tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'],
      startHour: 12,
      endHour: 15,
    })).toBe('These ads only show Tuesday to Sunday, 12:00 to 15:00; never mention Monday or every day.');
  });
});
