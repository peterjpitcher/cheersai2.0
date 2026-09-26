/**
 * Turns a PostgREST `or()` filter string into a row predicate for in-memory
 * Supabase mocks, with the database's rules: terms are ORed, several `or()`
 * calls on one query are ANDed (push one predicate per call), and a NULL
 * column never matches eq, neq or a comparison.
 *
 * Supports `col.eq.v`, `col.neq.v`, `col.gt.v`, `col.gte.v`, `col.lt.v`,
 * `col.lte.v`, `col.is.null` and `col.not.is.null`. Comparisons are on the
 * text value, which orders ISO dates and timestamps correctly. Anything else
 * (nested and()/or(), other operators) throws, so a mock never silently
 * matches a filter it does not understand.
 */
type Row = Record<string, unknown>;

const isNull = (value: unknown) => value === null || value === undefined;

function termPredicate(term: string): (row: Row) => boolean {
  if (term.includes('(')) throw new Error(`unsupported or() term ${term}`);
  const [column, ...parts] = term.split('.');
  if (parts[0] === 'not' && parts[1] === 'is' && parts[2] === 'null') return (row) => !isNull(row[column]);
  const [op, ...rest] = parts;
  const value = rest.join('.');
  if (op === 'is' && value === 'null') return (row) => isNull(row[column]);

  const compare = (row: Row, test: (cell: string) => boolean) => !isNull(row[column]) && test(String(row[column]));
  switch (op) {
    case 'eq':
      return (row) => compare(row, (cell) => cell === value);
    case 'neq':
      return (row) => compare(row, (cell) => cell !== value);
    case 'gt':
      return (row) => compare(row, (cell) => cell > value);
    case 'gte':
      return (row) => compare(row, (cell) => cell >= value);
    case 'lt':
      return (row) => compare(row, (cell) => cell < value);
    case 'lte':
      return (row) => compare(row, (cell) => cell <= value);
    default:
      throw new Error(`unsupported or() term ${term}`);
  }
}

export function orPredicate(filter: string): (row: Row) => boolean {
  const terms = filter.split(',').map((term) => termPredicate(term.trim()));
  return (row) => terms.some((test) => test(row));
}
