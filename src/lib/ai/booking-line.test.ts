import { describe, expect, it } from 'vitest';

import { bookingLineNamesEvent, bookingName, nameEventInBookingLine } from './booking-line';

describe('bookingLineNamesEvent', () => {
  it.each([
    ['the whole name', 'Book Snowball Showdown Cash Bingo through the link in our bio.', 'Snowball Showdown Cash Bingo'],
    ['the name without its event-type ending', 'Book Snowball Showdown through the link in our bio.', 'Snowball Showdown Cash Bingo'],
    ['the part before a colon', 'Book Sleigh My Name via the link in bio.', 'Sleigh My Name: Festive Music Bingo'],
    ['the part after a colon', 'Book Rocktober through the link in our bio.', 'Bingo: Rocktober'],
    ['a curly apostrophe against a straight one', "Book Santa's Grotto through the link in our bio.", 'Santa’s Grotto Quiz'],
    ['"and" for "&"', 'Book Tinsel and Trivia via the link in bio.', 'Tinsel & Trivia Quiz Night'],
    ['the name without its leading "The"', 'Book House of Horrors through the link in our bio.', 'The House of Horrors Halloween Party'],
    ['a different case', 'BOOK TINSEL & TIPPLES THROUGH THE LINK IN OUR BIO.', 'Tinsel & Tipples Christmas Tasting Night'],
  ])('accepts %s', (_label, line, eventName) => {
    expect(bookingLineNamesEvent(line, eventName)).toBe(true);
  });

  it.each([
    ['a line with no name', 'Book a place for each person through the link in our bio.', 'Snowball Showdown Cash Bingo'],
    ['only the kind of event', 'Book your quiz night table via the link in bio.', 'Tinsel & Trivia Quiz Night'],
    ['a generic part of a colon name', 'Book quiz night via the link in bio.', 'Quiz Night: Halloween Special'],
    ['a part of a colon name made only of event-type words', 'Book Festive Music Bingo via the link in bio.', 'Sleigh My Name: Festive Music Bingo'],
    ['part of a longer word', 'Book Rocktoberfest through the link in our bio.', 'Rocktober'],
  ])('refuses %s', (_label, line, eventName) => {
    expect(bookingLineNamesEvent(line, eventName)).toBe(false);
  });
});

describe('bookingName', () => {
  it('uses the part before a colon', () => {
    expect(bookingName('Sleigh My Name: Festive Music Bingo')).toBe('Sleigh My Name');
  });

  it('uses the first part that says which event it is', () => {
    expect(bookingName('Bingo: Rocktober')).toBe('Rocktober');
  });

  it('passes over a tagline before a colon', () => {
    expect(bookingName('Enter If You Dare: The House of Horrors Halloween Party')).toBe('The House of Horrors Halloween Party');
  });

  it('keeps the whole name when no part says which event it is', () => {
    expect(bookingName('Quiz Night: Halloween Special')).toBe('Quiz Night: Halloween Special');
  });

  it('keeps a name without a colon as given', () => {
    expect(bookingName('  Snowball Showdown Cash Bingo ')).toBe('Snowball Showdown Cash Bingo');
  });
});

describe('nameEventInBookingLine', () => {
  const EVENT = 'Snowball Showdown Cash Bingo';

  it('keeps a line that already names the event', () => {
    expect(nameEventInBookingLine('Book Snowball Showdown through the link in our bio.', EVENT))
      .toBe('Book Snowball Showdown through the link in our bio.');
  });

  it('puts the name where the line says what to book, keeping its wording', () => {
    expect(nameEventInBookingLine('Book a place for each person through the link in our bio.', EVENT))
      .toBe('Book a place for each person at Snowball Showdown Cash Bingo through the link in our bio.');
    expect(nameEventInBookingLine('Shared tables: book a place for each person via the link in bio.', EVENT))
      .toBe('Shared tables: book a place for each person at Snowball Showdown Cash Bingo via the link in bio.');
  });

  it('makes the event what is booked when the line only says "Book"', () => {
    expect(nameEventInBookingLine('Book through the link in our bio. Payment confirms your booking.', EVENT))
      .toBe('Book Snowball Showdown Cash Bingo through the link in our bio. Payment confirms your booking.');
  });

  it('reads on from "attending", and uses "for" when the line already says "at"', () => {
    expect(nameEventInBookingLine('Book a place for each person attending through the link in bio.', EVENT))
      .toBe('Book a place for each person attending Snowball Showdown Cash Bingo through the link in bio.');
    expect(nameEventInBookingLine('Book a table at The Anchor via the link in bio.', EVENT))
      .toBe('Book a table at The Anchor for Snowball Showdown Cash Bingo via the link in bio.');
  });

  it('names the event at the end of a line that starts with the link', () => {
    expect(nameEventInBookingLine('Use the link in bio to book a place for each person.', EVENT))
      .toBe('Use the link in bio to book a place for each person at Snowball Showdown Cash Bingo.');
    expect(nameEventInBookingLine('Use the link in bio to book a place for each person attending.', EVENT))
      .toBe('Use the link in bio to book a place for each person attending Snowball Showdown Cash Bingo.');
  });

  it('uses the part before a colon', () => {
    expect(nameEventInBookingLine('Book your table via the link in bio.', 'Sleigh My Name: Festive Music Bingo'))
      .toBe('Book your table at Sleigh My Name via the link in bio.');
  });

  it('puts the name in front of a line that does not say what to book', () => {
    expect(nameEventInBookingLine('Tap the link in our bio for tickets.', EVENT))
      .toBe('For Snowball Showdown Cash Bingo, tap the link in our bio for tickets.');
  });

  it('keeps the capitals of a first word that is not an ordinary word', () => {
    expect(nameEventInBookingLine('RSVP through the link in our bio.', EVENT))
      .toBe('For Snowball Showdown Cash Bingo, RSVP through the link in our bio.');
  });

  it.each([null, undefined, '', '   ', 'Link in bio to book.', 'Details in bio.', 'link in our bio'])(
    'writes a whole line for %j',
    (line) => {
      expect(nameEventInBookingLine(line, EVENT)).toBe('Book Snowball Showdown Cash Bingo through the link in our bio.');
    },
  );
});
