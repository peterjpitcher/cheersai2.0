import { describe, expect, it } from 'vitest';

import {
  openingOf,
  planSlotJobs,
  questionAllowed,
  questionsIn,
  renderCampaignPlan,
  slotJobSignals,
} from '@/lib/ai/slot-jobs';

const none = { hasFood: false, hasDressUpOrPrizes: false };

describe('planSlotJobs', () => {
  it('gives a seven-post campaign seven different jobs when the facts support them', () => {
    const slots = [
      '2026-10-20T06:00:00Z',
      '2026-10-27T07:00:00Z',
      '2026-11-03T07:00:00Z',
      '2026-11-08T07:00:00Z',
      '2026-11-15T07:00:00Z',
      '2026-11-19T07:00:00Z',
      '2026-11-20T07:00:00Z',
    ];
    expect(planSlotJobs(slots, { eventDate: '2026-11-20', host: 'Jo', hasFood: true, hasDressUpOrPrizes: true })).toEqual([
      'announce',
      'how_it_works',
      'meet_the_host',
      'dress_up_and_prizes',
      'eat_first',
      'last_call',
      'tonight',
    ]);
  });

  it('uses fresh angles when the facts run out, and only calls the last post a last call within three days', () => {
    const slots = ['2026-10-14T06:00:00Z', '2026-10-21T06:00:00Z', '2026-10-28T07:00:00Z', '2026-11-04T07:00:00Z', '2026-11-11T07:00:00Z'];
    expect(planSlotJobs(slots, { eventDate: '2026-11-11', ...none })).toEqual([
      'announce',
      'how_it_works',
      'fresh_angle',
      'fresh_angle',
      'tonight',
    ]);
  });

  it('plans short campaigns', () => {
    expect(planSlotJobs(['2026-11-01T08:00:00Z', '2026-11-03T08:00:00Z', '2026-11-04T08:00:00Z'], { eventDate: '2026-11-04', ...none })).toEqual([
      'announce',
      'last_call',
      'tonight',
    ]);
    expect(planSlotJobs(['2026-11-04T08:00:00Z'], { eventDate: '2026-11-04', ...none })).toEqual(['tonight']);
    expect(planSlotJobs(['2026-10-01T08:00:00Z', '2026-10-15T08:00:00Z'], { eventDate: '2026-11-04', ...none })).toEqual([
      'announce',
      'how_it_works',
    ]);
  });

  it('judges the event day by the London date, not UTC', () => {
    // 23:30 UTC on Friday 23 October 2026 is 00:30 on Saturday in British Summer Time.
    expect(planSlotJobs(['2026-10-20T08:00:00Z', '2026-10-23T23:30:00Z'], { eventDate: '2026-10-24', ...none })).toEqual([
      'announce',
      'tonight',
    ]);
  });

  it('gives a post after the event day a fresh angle, never a last call', () => {
    // Saturday 14 November is the day after the event, which the timing rules write as a recap.
    expect(planSlotJobs(['2026-11-06T08:00:00Z', '2026-11-13T08:00:00Z', '2026-11-14T10:00:00Z'], { eventDate: '2026-11-13', ...none })).toEqual([
      'announce',
      'tonight',
      'fresh_angle',
    ]);
    expect(planSlotJobs(['2026-11-14T10:00:00Z'], { eventDate: '2026-11-13', ...none })).toEqual(['fresh_angle']);
  });

  it('never gives meet the host without a host', () => {
    const jobs = planSlotJobs(
      ['2026-10-01T08:00:00Z', '2026-10-08T08:00:00Z', '2026-10-15T08:00:00Z', '2026-10-22T08:00:00Z'],
      { eventDate: '2026-11-30', host: '  ', ...none },
    );
    expect(jobs).not.toContain('meet_the_host');
  });
});

describe('campaign plan prompt', () => {
  it('allows a question in at most half the posts', () => {
    expect([1, 2, 3, 4, 5, 6, 7].map(questionAllowed)).toEqual([false, true, false, true, false, true, false]);
  });

  it('states the job, the earlier openings and questions, and the question rule', () => {
    const block = renderCampaignPlan({
      job: 'meet_the_host',
      host: 'Peter Pitcher',
      position: 3,
      total: 6,
      earlierOpenings: ['Quiz night is back on Wednesday 4th November.'],
      earlierQuestions: ['Which round will your team win?'],
      allowQuestion: false,
    });
    expect(block).toContain('this is post 3 of 6');
    expect(block).toContain('Lead with the host, Peter Pitcher');
    expect(block).toContain('- "Quiz night is back on Wednesday 4th November."');
    expect(block).toContain('"Which round will your team win?"');
    expect(block).toContain('Do not ask a question in this post.');
  });

  it('reads the opening and questions of a post', () => {
    const body = 'Sparks fly on Wednesday 4th November! Teams of up to six.\n\nWhich round will you win? Bring a pen.';
    expect(openingOf(body)).toBe('Sparks fly on Wednesday 4th November!');
    expect(questionsIn(body)).toEqual(['Which round will you win?']);
  });

  it('reads openings and questions that an emoji follows with no space', () => {
    expect(openingOf('Big night!🎉 Doors at 6:30pm.')).toBe('Big night!');
    expect(questionsIn('Which song?🎶 Which outfit?🕺 Book now.')).toEqual(['Which song?', 'Which outfit?']);
  });

  it('finds food and dressing-up in a brief', () => {
    expect(slotJobSignals('Our full dinner menu is available from 4pm.')).toEqual({ hasFood: true, hasDressUpOrPrizes: false });
    expect(slotJobSignals('Fancy dress encouraged, prizes for the best costume.')).toEqual({ hasFood: false, hasDressUpOrPrizes: true });
    expect(slotJobSignals('Book a seat for the quiz.')).toEqual(none);
  });
});
