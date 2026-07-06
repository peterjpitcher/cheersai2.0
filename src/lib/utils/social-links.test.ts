import { describe, expect, it } from 'vitest';

import {
  containsDirectLink,
  extractDirectLinks,
  stripDirectLinks,
  stripDirectLinkSentences,
} from './social-links';

describe('stripDirectLinks', () => {
  it('removes an https URL', () => {
    expect(stripDirectLinks('Book your table https://the-anchor.pub/book now')).toBe(
      'Book your table now',
    );
  });

  it('removes a bare domain', () => {
    expect(stripDirectLinks('Tickets from the-anchor.pub today')).toBe('Tickets from today');
  });

  it('removes a preceding "at" together with the link it belongs to', () => {
    expect(stripDirectLinks('Book at https://the-anchor.pub/book-table')).toBe('Book');
    expect(stripDirectLinks('Reserve via the-anchor.pub/book')).toBe('Reserve');
    expect(stripDirectLinks('Find us on the-anchor.pub')).toBe('Find us');
  });

  it('keeps the sentence period when a bare domain is removed after a preposition', () => {
    expect(stripDirectLinks('See us at the-anchor.pub.')).toBe('See us.');
  });

  // Regression: the old unconditional preposition trim ate these final words.
  it('leaves a legitimate trailing "on" / "at" / "via" untouched when there is no link', () => {
    expect(stripDirectLinks('The match is on')).toBe('The match is on');
    expect(stripDirectLinks("Come and see what we're on")).toBe("Come and see what we're on");
    expect(stripDirectLinks('Pull up a chair at')).toBe('Pull up a chair at');
    expect(stripDirectLinks('Order your drinks via')).toBe('Order your drinks via');
  });

  it('leaves a mid-sentence "on" untouched, only stripping the preposition tied to a link', () => {
    expect(stripDirectLinks('Join us on Friday')).toBe('Join us on Friday');
    expect(
      stripDirectLinks('Follow us on Facebook and book on the-anchor.pub'),
    ).toBe('Follow us on Facebook and book');
  });

  it('returns link-free copy unchanged apart from whitespace tidy', () => {
    expect(stripDirectLinks('Great food and a warm welcome.')).toBe(
      'Great food and a warm welcome.',
    );
  });

  // Regression: a full stop with no following space ("Sat.Come") must not be
  // treated as a bare domain.
  it('does not treat two words joined by a full stop with no space as a domain', () => {
    expect(stripDirectLinks('Big match on Sat.Come early to grab a seat.')).toBe(
      'Big match on Sat.Come early to grab a seat.',
    );
    expect(stripDirectLinks('Enjoy our food.Comedy night starts at 8.')).toBe(
      'Enjoy our food.Comedy night starts at 8.',
    );
    expect(stripDirectLinks('Mr.Smith is hosting the quiz.')).toBe('Mr.Smith is hosting the quiz.');
  });

  it('still matches multi-label domains and real TLDs', () => {
    expect(stripDirectLinks('Tickets at the-anchor.co.uk today')).toBe('Tickets today');
    expect(stripDirectLinks('Join the crew at vip-club.uk')).toBe('Join the crew');
  });
});

describe('containsDirectLink', () => {
  it('detects URLs and bare domains but not ordinary prepositions', () => {
    expect(containsDirectLink('Book at the-anchor.pub')).toBe(true);
    expect(containsDirectLink('https://example.com')).toBe(true);
    expect(containsDirectLink('The match is on')).toBe(false);
    expect(containsDirectLink('Join us on Friday')).toBe(false);
  });
});

describe('extractDirectLinks', () => {
  it('returns links with trailing punctuation stripped', () => {
    expect(extractDirectLinks('Visit the-anchor.pub, see you soon')).toEqual(['the-anchor.pub']);
  });
});

describe('stripDirectLinkSentences', () => {
  it('drops a whole sentence containing a link and keeps the rest', () => {
    expect(
      stripDirectLinkSentences('Live music tonight. Book at the-anchor.pub/table.'),
    ).toBe('Live music tonight.');
  });

  it('leaves link-free copy that ends in "on" untouched', () => {
    expect(stripDirectLinkSentences('The big match is on')).toBe('The big match is on');
  });

  // Regression: the reported detonation — a single line of missing-space prose
  // was matched as a link and the whole body returned "".
  it('does not blank a body when a full stop has no following space', () => {
    expect(stripDirectLinkSentences('Great food.Great drinks.See you soon.')).toBe(
      'Great food.Great drinks.See you soon.',
    );
    expect(stripDirectLinkSentences('Match on Sat.Come early. Kids welcome too.')).toBe(
      'Match on Sat.Come early. Kids welcome too.',
    );
  });
});
