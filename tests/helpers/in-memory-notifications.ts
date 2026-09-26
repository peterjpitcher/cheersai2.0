import { randomUUID } from 'node:crypto';

/**
 * In-memory `public.notifications` table that rejects rows the way the live
 * table does. A mock that accepted any row hid a missing NOT NULL `message`
 * for four months, so inserts here fail with the same Postgres errors.
 *
 * Columns come from information_schema.columns on the live project
 * (nbkjciurhvkfpcpatbnt), checked 2026-09-26. Keep them in step with live,
 * not with supabase/SCHEMA.md.
 */

type Row = Record<string, unknown>;

export interface PgError {
  code: string;
  message: string;
}

interface ColumnSpec {
  notNull: boolean;
  uuid?: boolean;
  defaultValue?: () => unknown;
}

export const LIVE_NOTIFICATION_COLUMNS: Record<string, ColumnSpec> = {
  id: { notNull: true, uuid: true, defaultValue: () => randomUUID() },
  account_id: { notNull: true, uuid: true },
  category: { notNull: false },
  message: { notNull: true },
  read_at: { notNull: false },
  metadata: { notNull: false },
  created_at: { notNull: true, defaultValue: () => new Date().toISOString() },
  urgency: { notNull: false, defaultValue: () => 'standard' },
  title: { notNull: false },
  body: { notNull: false },
  resource_type: { notNull: false },
  resource_id: { notNull: false, uuid: true },
  dismissed_at: { notNull: false },
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type QueryResult = { data: Row[] | null; error: PgError | null };

class SelectQuery implements PromiseLike<QueryResult> {
  private readonly filters: Array<(row: Row) => boolean> = [];
  private max = Number.POSITIVE_INFINITY;

  constructor(
    private readonly table: InMemoryNotificationsTable,
    private readonly columns: string,
  ) {}

  eq(column: string, value: unknown): this {
    this.filters.push((row) => row[column] === value);
    return this;
  }

  in(column: string, values: unknown[]): this {
    this.filters.push((row) => values.includes(row[column]));
    return this;
  }

  gte(column: string, value: string): this {
    this.filters.push((row) => typeof row[column] === 'string' && Date.parse(row[column]) >= Date.parse(value));
    return this;
  }

  /** Supports the JSON text filter the crons use, e.g. `metadata->>job_id`. */
  filter(path: string, operator: string, value: unknown): this {
    const match = /^(\w+)->>(\w+)$/.exec(path);
    if (!match || operator !== 'eq') {
      throw new Error(`in-memory notifications: unsupported filter ${path} ${operator}`);
    }
    const [, column, key] = match;
    this.filters.push((row) => {
      const json = row[column];
      return json !== null && typeof json === 'object' && String((json as Row)[key]) === String(value);
    });
    return this;
  }

  limit(count: number): this {
    this.max = count;
    return this;
  }

  async maybeSingle(): Promise<{ data: Row | null; error: PgError | null }> {
    const { data, error } = await this.execute();
    if (error) return { data: null, error };
    if (data && data.length > 1) {
      return { data: null, error: { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' } };
    }
    return { data: data?.[0] ?? null, error: null };
  }

  then<TResult1 = QueryResult, TResult2 = never>(
    onfulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return this.execute().then(onfulfilled, onrejected);
  }

  private async execute(): Promise<QueryResult> {
    if (this.table.selectError) {
      return { data: null, error: { code: 'XX000', message: this.table.selectError } };
    }
    const wanted = this.columns.split(',').map((column) => column.trim());
    const rows = this.table.rows
      .filter((row) => this.filters.every((matches) => matches(row)))
      .slice(0, this.max)
      .map((row) => (wanted.includes('*') ? { ...row } : Object.fromEntries(wanted.map((column) => [column, row[column]]))));
    return { data: rows, error: null };
  }
}

export class InMemoryNotificationsTable {
  rows: Row[] = [];

  /** Set to make every insert fail, as a lost connection or a bad deploy would. */
  insertError: string | null = null;

  /** Set to make every select fail. */
  selectError: string | null = null;

  /** Seed rows directly; they go through the same checks as an insert. */
  seed(...rows: Row[]): void {
    for (const row of rows) {
      const result = this.validate(row);
      if ('error' in result) throw new Error(`in-memory notifications seed rejected: ${result.error.message}`);
      this.rows.push(result.row);
    }
  }

  /** Mirrors `supabase.from('notifications')` for the calls this table supports. */
  from(table: string) {
    if (table !== 'notifications') {
      throw new Error(`in-memory notifications: unexpected table ${table}`);
    }
    return {
      select: (columns = '*') => new SelectQuery(this, columns),
      insert: async (input: Row | Row[]): Promise<{ data: null; error: PgError | null }> => {
        if (this.insertError) {
          return { data: null, error: { code: 'XX000', message: this.insertError } };
        }
        // A multi-row insert is one statement: one bad row rejects them all.
        const validated = [];
        for (const row of Array.isArray(input) ? input : [input]) {
          const result = this.validate(row);
          if ('error' in result) return { data: null, error: result.error };
          validated.push(result.row);
        }
        this.rows.push(...validated);
        return { data: null, error: null };
      },
    };
  }

  private validate(input: Row): { row: Row } | { error: PgError } {
    for (const column of Object.keys(input)) {
      if (!(column in LIVE_NOTIFICATION_COLUMNS)) {
        return {
          error: { code: 'PGRST204', message: `Could not find the '${column}' column of 'notifications' in the schema cache` },
        };
      }
    }

    const row: Row = {};
    for (const [column, spec] of Object.entries(LIVE_NOTIFICATION_COLUMNS)) {
      // supabase-js drops undefined keys, so undefined means "not sent" and the
      // default applies; an explicit null does not get the default, as in Postgres.
      let value = input[column];
      if (value === undefined) value = spec.defaultValue ? spec.defaultValue() : null;

      if (value === null && spec.notNull) {
        return {
          error: {
            code: '23502',
            message: `null value in column "${column}" of relation "notifications" violates not-null constraint`,
          },
        };
      }
      if (value !== null && spec.uuid && (typeof value !== 'string' || !UUID_PATTERN.test(value))) {
        return { error: { code: '22P02', message: `invalid input syntax for type uuid: "${String(value)}"` } };
      }
      row[column] = value;
    }
    return { row };
  }
}
