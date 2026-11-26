import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { GoogleBrand } from '@/lib/google-posts/brands';
import { listGoogleBrands } from '@/lib/google-posts/brands';
import {
  buildGoogleWordingPrompt,
  checkGoogleWording,
  describeEventWhen,
  GOOGLE_WORDING_SYSTEM_PROMPT,
  MAX_WORDING_ATTEMPTS,
  WORDING_BATCH,
  writeGoogleWordings,
  type GoogleWordingInput,
  type GoogleWordingWriter,
} from '@/lib/google-posts/wording';

import { ACCOUNT, addPost, createWorld, PARENT, type World } from './world';

const FACEBOOK =
  'Quiz Night is this Wednesday, Wednesday 2nd December, at The Anchor, Stanwell Moor Village.\n\nDoors from 6:30pm, quiz from 7pm to 9:30pm. Entry is £3 per person, paid in cash on arrival. Free parking on site. #quiz';

const input = (overrides: Partial<GoogleWordingInput> = {}): GoogleWordingInput => ({
  venueName: 'The Anchor',
  topicType: 'EVENT',
  eventTitle: 'Tinsel & Trivia Quiz Night',
  eventWhen: 'Wednesday 2 December 2026, 7:00pm to 9:30pm',
  facebookCopy: FACEBOOK,
  ...overrides,
});

const GOOD =
  'Quiz Night at The Anchor, Stanwell Moor Village, is on Wednesday 2nd December from 7pm to 9:30pm.\n\nDoors open at 6:30pm. Entry is £3 per person, paid in cash on arrival, and there is free parking on site.';

describe('checking an AI draft of Google wording', () => {
  it('accepts a draft that only re-says the Facebook post, and applies the copy rules to it', () => {
    const result = checkGoogleWording(`${GOOD} #quiznight Book at https://example.com/quiz`, input());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.summary).toContain('Wednesday 2nd December from 7pm to 9:30pm');
    expect(result.summary).not.toMatch(/#|https?:/);
  });

  it.each([
    ['a price that is not in the Facebook post', GOOD.replace('£3', '£5'), 'new_number'],
    ['a time that is not in the Facebook post', GOOD.replace('7pm', '8pm'), 'new_number'],
    ['a time written another way', GOOD.replace('6:30pm', '18:30'), 'new_number'],
    // A number that is in the Facebook post, but as something else: 7 is a time there, never a price.
    ['a price made from a number that is only a time in the Facebook post', GOOD.replace('£3', '£7'), 'new_number'],
    ['a time moved from evening to morning', GOOD.replace('7pm', '7am'), 'new_number'],
    ['a time that has lost its am or pm', GOOD.replace('from 7pm to 9:30pm', 'from 7 to 9:30pm'), 'new_number'],
    ['a price that has lost its pound sign into a time', GOOD.replace('6:30pm', '3pm'), 'new_number'],
    ['a percentage that is not in the Facebook post', `${GOOD} Save 3% when you book.`, 'new_number'],
    ['a day that is not in the Facebook post', GOOD.replace('Wednesday', 'Thursday'), 'new_date_word'],
    ['a month that is not in the Facebook post', GOOD.replace('December', 'January'), 'new_date_word'],
    ['"tonight" when the Facebook post does not say it', `${GOOD} Join us tonight.`, 'new_date_word'],
    ['nothing at all', '   ', 'empty'],
    ['a few words', 'Quiz Night soon.', 'too_short'],
    ['a drinks price offer', `${GOOD} It is £3 pints all night.`, 'would_be_held'],
  ])('refuses %s', (_label, draft, reason) => {
    expect(checkGoogleWording(draft, input())).toEqual({ ok: false, reason });
  });

  it('refuses "free" when the Facebook post never says it', () => {
    const noFree = input({ facebookCopy: FACEBOOK.replace(' Free parking on site.', '') });
    expect(checkGoogleWording(GOOD.replace(', and there is free parking on site', ''), noFree).ok).toBe(true);
    expect(checkGoogleWording(GOOD, noFree)).toEqual({ ok: false, reason: 'new_free_claim' });
  });

  it('lets the event details given to the AI count as known facts', () => {
    // The year comes from the event time, not the Facebook copy.
    expect(checkGoogleWording(GOOD.replace('2nd December', '2nd December 2026'), input()).ok).toBe(true);
    expect(checkGoogleWording(GOOD.replace('2nd December', '2nd December 2026'), input({ eventWhen: null }))).toEqual({
      ok: false,
      reason: 'new_number',
    });
  });

  it('reads a price or a time the same however it is spaced or capitalised', () => {
    const spaced = input({ facebookCopy: FACEBOOK.replace('7pm to 9:30pm', '7 PM to 9:30 PM').replace('£3', '£ 3') });
    expect(checkGoogleWording(GOOD, spaced).ok).toBe(true);
  });

  it('does not treat the ordinary word "may" as a month', () => {
    expect(checkGoogleWording(`${GOOD} You may book a table for your team.`, input()).ok).toBe(true);
  });
});

describe('the prompt', () => {
  it('gives the AI the venue, the event and the Facebook copy, and nothing else', () => {
    const prompt = buildGoogleWordingPrompt(input());
    expect(prompt).toContain('Venue: The Anchor');
    expect(prompt).toContain('This is an event post for: Tinsel & Trivia Quiz Night');
    expect(prompt).toContain('Event time: Wednesday 2 December 2026, 7:00pm to 9:30pm');
    expect(prompt).toContain(FACEBOOK);
    expect(buildGoogleWordingPrompt(input({ topicType: 'STANDARD', eventTitle: null, eventWhen: null }))).not.toContain('event post');
  });

  it('tells the AI never to add facts, and never names the product in a way the coupling test forbids', () => {
    expect(GOOGLE_WORDING_SYSTEM_PROMPT).toContain('Never add, change or guess a price, time, date');
    expect(GOOGLE_WORDING_SYSTEM_PROMPT).not.toContain('Google Business Profile');
  });

  it('describes event times in London time, in winter (GMT) and summer (BST)', () => {
    expect(describeEventWhen('2026-12-02T19:00:00.000Z', '2026-12-02T21:30:00.000Z')).toBe('Wednesday 2 December 2026, 7:00pm to 9:30pm');
    // 18:00 UTC in July is 7pm in London.
    expect(describeEventWhen('2026-07-15T18:00:00.000Z', '2026-07-15T20:30:00.000Z')).toBe('Wednesday 15 July 2026, 7:00pm to 9:30pm');
    expect(describeEventWhen(null, null)).toBeNull();
  });
});

describe('the wording job', () => {
  let world: World;
  let writer: ReturnType<typeof vi.fn<GoogleWordingWriter>>;

  const brand = async (): Promise<GoogleBrand> => (await listGoogleBrands(world.deps.db))[0];
  const run = async () =>
    writeGoogleWordings({ ...world.deps, writeWording: writer }, await brand(), { deadline: world.clock.now().getTime() + 105_000 });

  function addWaiting(overrides: Record<string, unknown> = {}, body: string = FACEBOOK): string {
    const postId = addPost(world, { body });
    world.db.seed('gbp_posts', [
      {
        account_id: ACCOUNT,
        content_item_id: postId,
        local_post_parent: PARENT,
        state: 'pending',
        summary: 'Derived from Facebook.',
        wording_source: 'awaiting_ai',
        ...overrides,
      },
    ]);
    return postId;
  }
  const row = (postId: string) => world.db.tables.gbp_posts.find((candidate) => candidate.content_item_id === postId)!;

  beforeEach(() => {
    world = createWorld();
    writer = vi.fn<GoogleWordingWriter>(async () => GOOD);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('stores a checked draft and marks the wording as written for Google', async () => {
    const postId = addWaiting();
    const summary = await run();
    expect(summary).toMatchObject({ written: 1, retried: 0, fellBack: 0, errors: 0 });
    expect(row(postId)).toMatchObject({ wording_source: 'ai', state: 'pending' });
    expect(row(postId).summary).toContain('Quiz Night at The Anchor');
    expect(writer).toHaveBeenCalledWith(
      expect.objectContaining({ venueName: 'Test Pub', facebookCopy: FACEBOOK, topicType: 'STANDARD' }),
      { accountId: ACCOUNT },
    );
  });

  it('keeps the derived wording when a draft is refused, tries again, then falls back to the Facebook wording', async () => {
    writer.mockResolvedValue(GOOD.replace('£3', '£5'));
    const postId = addWaiting();
    for (let attempt = 1; attempt < MAX_WORDING_ATTEMPTS; attempt += 1) {
      expect(await run()).toMatchObject({ written: 0, retried: 1 });
      expect(row(postId)).toMatchObject({ wording_source: 'awaiting_ai', wording_attempts: attempt, summary: 'Derived from Facebook.' });
    }
    expect(await run()).toMatchObject({ fellBack: 1 });
    expect(row(postId)).toMatchObject({ wording_source: 'facebook', summary: 'Derived from Facebook.' });
    // Given up: never asked again.
    writer.mockClear();
    await run();
    expect(writer).not.toHaveBeenCalled();
  });

  it('asks again after an AI outage without counting it towards giving up', async () => {
    writer.mockRejectedValue(new Error('OpenAI is down'));
    const postId = addWaiting();
    for (let run_ = 0; run_ < MAX_WORDING_ATTEMPTS + 2; run_ += 1) {
      expect(await run()).toMatchObject({ written: 0, retried: 1, fellBack: 0, errors: 0 });
    }
    expect(row(postId)).toMatchObject({ wording_source: 'awaiting_ai', wording_attempts: 0, summary: 'Derived from Facebook.' });

    // Back up: the post gets its Google wording.
    writer.mockResolvedValue(GOOD);
    expect(await run()).toMatchObject({ written: 1 });
    expect(row(postId).wording_source).toBe('ai');
  });

  it('never touches a post marked to keep its wording, an edited post, a held post or a sent post', async () => {
    const kept = addWaiting({ wording_source: 'facebook' });
    const edited = addWaiting({ summary_edited_at: '2026-11-16T09:00:00.000Z', wording_source: 'person' });
    const held = addWaiting({ state: 'held', hold_reason: 'alcohol_promotion' });
    const sent = addWaiting({ state: 'sent', google_post_name: `${PARENT}/localPosts/1`, sent_at: '2026-11-16T09:00:00.000Z' });
    expect(await run()).toMatchObject({ written: 0, retried: 0, fellBack: 0 });
    expect(writer).not.toHaveBeenCalled();
    for (const postId of [kept, edited, held, sent]) expect(row(postId).summary).toBe('Derived from Facebook.');
  });

  it('writes only a few posts a run, starts no call it has no time for, and does nothing without a writer', async () => {
    for (let index = 0; index < WORDING_BATCH + 2; index += 1) addWaiting();
    expect(await run()).toMatchObject({ written: WORDING_BATCH });
    expect(writer).toHaveBeenCalledTimes(WORDING_BATCH);

    writer.mockClear();
    const short = await writeGoogleWordings({ ...world.deps, writeWording: writer }, await brand(), { deadline: world.clock.now().getTime() + 10_000 });
    expect(short.written).toBe(0);
    expect(writer).not.toHaveBeenCalled();

    expect(await writeGoogleWordings(world.deps, await brand(), { deadline: world.clock.now().getTime() + 105_000 })).toMatchObject({ written: 0 });
  });

  it('does not overwrite a post a person edited while the AI was writing', async () => {
    const postId = addWaiting();
    writer.mockImplementation(async () => {
      Object.assign(row(postId), { summary: 'My own words.', summary_edited_at: '2026-11-16T10:00:30.000Z', wording_source: 'person', updated_at: '2026-11-16T10:00:30.000Z' });
      return GOOD;
    });
    expect(await run()).toMatchObject({ written: 0 });
    expect(row(postId)).toMatchObject({ summary: 'My own words.', wording_source: 'person' });
  });

  it('puts a post with no Facebook wording back on the Facebook wording without calling the AI', async () => {
    const postId = addWaiting({}, '');
    expect(await run()).toMatchObject({ fellBack: 1 });
    expect(writer).not.toHaveBeenCalled();
    expect(row(postId).wording_source).toBe('facebook');
  });
});
