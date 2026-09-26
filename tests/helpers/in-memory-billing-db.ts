import { randomUUID } from 'node:crypto';

import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * A small in-memory stand-in for the Supabase query builder, for billing tests.
 *
 * It enforces the constraints of the live billing tables (checked against
 * production on 2026-09-26 with SELECT-only queries, including
 * account_members and user_auth_snapshot): NOT NULL columns, CHECK
 * lists, primary keys, unique keys and the account foreign keys, and rejects
 * unknown columns. A write the real database would refuse is refused here with
 * the same Postgres error code, so a test cannot pass on a row production
 * would reject.
 *
 * Supports the builder calls the billing code uses: select (with count/head),
 * insert, update, delete, eq, neq, lt, lte, gt, gte, in, is, order, limit,
 * maybeSingle, single, returns. Failures can be injected per table and
 * operation to simulate an outage.
 */

type Row = Record<string, unknown>;
type ColumnType = 'uuid' | 'text' | 'timestamptz' | 'boolean' | 'jsonb';
type Op = 'select' | 'insert' | 'update' | 'delete';

interface ColumnSpec {
  type: ColumnType;
  notNull?: boolean;
  default?: () => unknown;
  check?: readonly unknown[];
}

interface TableSpec {
  columns: Record<string, ColumnSpec>;
  primaryKey: string[];
  unique?: string[][];
  foreignKeys?: Array<{ column: string; table: string; references: string }>;
}

const now = (): string => new Date().toISOString();

const SUBSCRIPTION_STATUSES = ['trialing', 'active', 'past_due', 'canceled', 'unpaid', 'incomplete', 'incomplete_expired', 'paused'] as const;

export const BILLING_SCHEMA: Record<string, TableSpec> = {
  accounts: {
    columns: {
      id: { type: 'uuid', notNull: true },
      business_name: { type: 'text' },
      email: { type: 'text' },
      archived_at: { type: 'timestamptz' },
      billing_override: { type: 'text', check: ['comped', 'suspended'] },
    },
    primaryKey: ['id'],
  },
  billing_customers: {
    columns: {
      account_id: { type: 'uuid', notNull: true },
      stripe_customer_id: { type: 'text', notNull: true },
      created_at: { type: 'timestamptz', notNull: true, default: now },
    },
    primaryKey: ['account_id'],
    unique: [['stripe_customer_id']],
    foreignKeys: [{ column: 'account_id', table: 'accounts', references: 'id' }],
  },
  subscriptions: {
    columns: {
      stripe_subscription_id: { type: 'text', notNull: true },
      account_id: { type: 'uuid', notNull: true },
      stripe_customer_id: { type: 'text', notNull: true },
      status: { type: 'text', notNull: true, check: SUBSCRIPTION_STATUSES },
      plan: { type: 'text', notNull: true, check: ['starter', 'professional', 'group'] },
      billing_interval: { type: 'text', notNull: true, check: ['month', 'year'] },
      stripe_price_id: { type: 'text', notNull: true },
      trial_end: { type: 'timestamptz' },
      // Added by 20260926120000_subscriptions_period_start.sql (not yet applied live).
      current_period_start: { type: 'timestamptz' },
      current_period_end: { type: 'timestamptz' },
      cancel_at_period_end: { type: 'boolean', notNull: true, default: () => false },
      canceled_at: { type: 'timestamptz' },
      stripe_state_at: { type: 'timestamptz', notNull: true },
      created_at: { type: 'timestamptz', notNull: true, default: now },
      updated_at: { type: 'timestamptz', notNull: true, default: now },
    },
    primaryKey: ['stripe_subscription_id'],
    foreignKeys: [{ column: 'account_id', table: 'accounts', references: 'id' }],
  },
  stripe_events: {
    columns: {
      id: { type: 'text', notNull: true },
      type: { type: 'text', notNull: true },
      received_at: { type: 'timestamptz', notNull: true, default: now },
      processed_at: { type: 'timestamptz' },
      error: { type: 'text' },
    },
    primaryKey: ['id'],
  },
  // Who owns a brand: the fallback contact email for its Stripe customer.
  account_members: {
    columns: {
      account_id: { type: 'uuid', notNull: true },
      user_id: { type: 'uuid', notNull: true },
      role: { type: 'text', notNull: true, default: () => 'owner', check: ['owner', 'member'] },
      created_at: { type: 'timestamptz', notNull: true, default: now },
      created_by: { type: 'uuid' },
    },
    primaryKey: ['account_id', 'user_id'],
    foreignKeys: [{ column: 'account_id', table: 'accounts', references: 'id' }],
  },
  user_auth_snapshot: {
    columns: {
      user_id: { type: 'uuid', notNull: true },
      email: { type: 'text', notNull: true },
      status: { type: 'text', notNull: true, default: () => 'active' },
      created_at: { type: 'timestamptz', notNull: true, default: now },
      last_sign_in_at: { type: 'timestamptz' },
      updated_at: { type: 'timestamptz', notNull: true, default: now },
    },
    primaryKey: ['user_id'],
  },
  // Only the columns releaseHeldPublishJobs touches.
  publish_jobs: {
    columns: {
      id: { type: 'uuid', notNull: true, default: () => randomUUID() },
      account_id: { type: 'uuid', notNull: true },
      status: { type: 'text', notNull: true },
      hold_reason: { type: 'text' },
      last_error: { type: 'text' },
      next_attempt_at: { type: 'timestamptz' },
      updated_at: { type: 'timestamptz', notNull: true, default: now },
    },
    primaryKey: ['id'],
  },
  admin_audit: {
    columns: {
      id: { type: 'uuid', notNull: true, default: () => randomUUID() },
      actor_user_id: { type: 'uuid' },
      action: { type: 'text', notNull: true },
      target_user_id: { type: 'uuid' },
      target_account_id: { type: 'uuid' },
      detail: { type: 'jsonb' },
      result: { type: 'text', notNull: true, default: () => 'success' },
      created_at: { type: 'timestamptz', notNull: true, default: now },
    },
    primaryKey: ['id'],
  },
};

export interface DbError {
  code: string;
  message: string;
  details: null;
  hint: null;
}

function dbError(code: string, message: string): DbError {
  return { code, message, details: null, hint: null };
}

interface Failure {
  table: string;
  op: Op;
  error: DbError;
  times: number;
}

export class InMemoryBillingDb {
  tables: Record<string, Row[]> = Object.fromEntries(Object.keys(BILLING_SCHEMA).map((name) => [name, []]));
  private failures: Failure[] = [];
  /** Every write, in order, for assertions about ordering. */
  writes: Array<{ table: string; op: Op; rows: Row[] }> = [];
  /** Every query run, with its equality filters, for assertions about brand scoping. */
  queries: Array<{ table: string; op: Op; columns: string | null; eq: Array<[string, unknown]> }> = [];

  seed(table: string, rows: Row[]): void {
    for (const row of rows) {
      const result = this.insertRows(table, [row]);
      if (result.error) throw new Error(`seed ${table} failed: ${result.error.message}`);
    }
  }

  rows(table: string): Row[] {
    return this.tables[table].map((row) => ({ ...row }));
  }

  /** Make the next `times` calls of `op` on `table` fail like an outage. */
  fail(table: string, op: Op, times = Number.POSITIVE_INFINITY, message = 'connection refused'): void {
    this.failures.push({ table, op, error: dbError('08006', message), times });
  }

  takeFailure(table: string, op: Op): DbError | null {
    const failure = this.failures.find((f) => f.table === table && f.op === op && f.times > 0);
    if (!failure) return null;
    failure.times -= 1;
    return failure.error;
  }

  client(): SupabaseClient {
    return { from: (table: string) => new Query(this, table) } as unknown as SupabaseClient;
  }

  spec(table: string): TableSpec {
    const spec = BILLING_SCHEMA[table];
    if (!spec) throw new Error(`in-memory db: unknown table ${table}`);
    return spec;
  }

  /** Validate a full candidate row against the table's column rules. */
  validate(table: string, row: Row): DbError | null {
    const spec = this.spec(table);
    for (const column of Object.keys(row)) {
      if (!(column in spec.columns)) return dbError('42703', `column "${column}" of relation "${table}" does not exist`);
    }
    for (const [column, rule] of Object.entries(spec.columns)) {
      const value = row[column];
      if (rule.notNull && (value === null || value === undefined)) {
        return dbError('23502', `null value in column "${column}" of relation "${table}" violates not-null constraint`);
      }
      if (value !== null && value !== undefined && rule.check && !rule.check.includes(value)) {
        return dbError('23514', `new row for relation "${table}" violates check constraint "${table}_${column}_check"`);
      }
      if (value !== null && value !== undefined && rule.type === 'timestamptz' && Number.isNaN(Date.parse(String(value)))) {
        return dbError('22007', `invalid input syntax for type timestamp with time zone: "${String(value)}"`);
      }
      if (value !== null && value !== undefined && rule.type === 'boolean' && typeof value !== 'boolean') {
        return dbError('22P02', `invalid input syntax for type boolean: "${String(value)}"`);
      }
    }
    for (const fk of spec.foreignKeys ?? []) {
      const value = row[fk.column];
      if (value === null || value === undefined) continue;
      if (!this.tables[fk.table].some((other) => other[fk.references] === value)) {
        return dbError('23503', `insert or update on table "${table}" violates foreign key constraint "${table}_${fk.column}_fkey"`);
      }
    }
    return null;
  }

  conflicts(table: string, row: Row, ignore: Row | null): DbError | null {
    const spec = this.spec(table);
    for (const key of [spec.primaryKey, ...(spec.unique ?? [])]) {
      const clash = this.tables[table].some((other) => other !== ignore && key.every((column) => other[column] === row[column]));
      if (clash) return dbError('23505', `duplicate key value violates unique constraint "${table}_${key.join('_')}_key"`);
    }
    return null;
  }

  insertRows(table: string, input: Row[]): { data: Row[] | null; error: DbError | null } {
    const spec = this.spec(table);
    const prepared: Row[] = [];
    for (const raw of input) {
      const row: Row = { ...raw };
      for (const [column, rule] of Object.entries(spec.columns)) {
        if (row[column] === undefined) row[column] = rule.default ? rule.default() : null;
      }
      const error = this.validate(table, row) ?? this.conflicts(table, row, null);
      if (error) return { data: null, error };
      if (prepared.some((other) => spec.primaryKey.every((column) => other[column] === row[column]))) {
        return { data: null, error: dbError('23505', `duplicate key value violates unique constraint "${table}_pkey"`) };
      }
      prepared.push(row);
    }
    this.tables[table].push(...prepared);
    this.writes.push({ table, op: 'insert', rows: prepared.map((row) => ({ ...row })) });
    return { data: prepared.map((row) => ({ ...row })), error: null };
  }
}

type Filter = (row: Row) => boolean;

function compare(spec: ColumnSpec | undefined, a: unknown, b: unknown): number {
  if (spec?.type === 'timestamptz') return Date.parse(String(a)) - Date.parse(String(b));
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b));
}

class Query implements PromiseLike<{ data: unknown; error: DbError | null; count?: number | null }> {
  private op: Op = 'select';
  private filters: Filter[] = [];
  private eqFilters: Array<[string, unknown]> = [];
  private payload: Row | Row[] | null = null;
  private returning = false;
  private columns: string | null = null;
  private orderBy: Array<{ column: string; ascending: boolean }> = [];
  private limitTo: number | null = null;
  private mode: 'many' | 'maybe' | 'one' = 'many';
  private head = false;
  private counted = false;

  constructor(
    private readonly db: InMemoryBillingDb,
    private readonly table: string,
  ) {
    db.spec(table);
  }

  select(columns?: string, options?: { count?: string; head?: boolean }): this {
    if (this.op === 'select') {
      this.columns = columns ?? '*';
      this.head = Boolean(options?.head);
      this.counted = Boolean(options?.count);
    } else {
      this.returning = true;
      this.columns = columns ?? '*';
    }
    return this;
  }

  insert(rows: Row | Row[]): this {
    this.op = 'insert';
    this.payload = rows;
    return this;
  }

  update(values: Row): this {
    this.op = 'update';
    this.payload = values;
    return this;
  }

  delete(): this {
    this.op = 'delete';
    return this;
  }

  private column(name: string): ColumnSpec {
    const spec = this.db.spec(this.table).columns[name];
    if (!spec) throw new Error(`in-memory db: unknown column ${this.table}.${name}`);
    return spec;
  }

  eq(column: string, value: unknown): this {
    this.column(column);
    this.eqFilters.push([column, value]);
    this.filters.push((row) => row[column] === value);
    return this;
  }

  neq(column: string, value: unknown): this {
    this.column(column);
    this.filters.push((row) => row[column] !== value);
    return this;
  }

  lt(column: string, value: unknown): this {
    const spec = this.column(column);
    this.filters.push((row) => row[column] !== null && row[column] !== undefined && compare(spec, row[column], value) < 0);
    return this;
  }

  lte(column: string, value: unknown): this {
    const spec = this.column(column);
    this.filters.push((row) => row[column] !== null && row[column] !== undefined && compare(spec, row[column], value) <= 0);
    return this;
  }

  gt(column: string, value: unknown): this {
    const spec = this.column(column);
    this.filters.push((row) => row[column] !== null && row[column] !== undefined && compare(spec, row[column], value) > 0);
    return this;
  }

  gte(column: string, value: unknown): this {
    const spec = this.column(column);
    this.filters.push((row) => row[column] !== null && row[column] !== undefined && compare(spec, row[column], value) >= 0);
    return this;
  }

  in(column: string, values: unknown[]): this {
    this.column(column);
    this.filters.push((row) => values.includes(row[column]));
    return this;
  }

  is(column: string, value: null | boolean): this {
    this.column(column);
    this.filters.push((row) => (value === null ? row[column] === null || row[column] === undefined : row[column] === value));
    return this;
  }

  /** Repeated calls add tie-breakers, as in PostgREST. */
  order(column: string, options?: { ascending?: boolean }): this {
    this.column(column);
    this.orderBy.push({ column, ascending: options?.ascending ?? true });
    return this;
  }

  limit(count: number): this {
    this.limitTo = count;
    return this;
  }

  returns(): this {
    return this;
  }

  maybeSingle(): Promise<{ data: unknown; error: DbError | null }> {
    this.mode = 'maybe';
    return this.execute();
  }

  single(): Promise<{ data: unknown; error: DbError | null }> {
    this.mode = 'one';
    return this.execute();
  }

  then<TResult1 = { data: unknown; error: DbError | null; count?: number | null }, TResult2 = never>(
    onfulfilled?: ((value: { data: unknown; error: DbError | null; count?: number | null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return this.execute().then(onfulfilled, onrejected);
  }

  private project(rows: Row[]): Row[] {
    if (!this.columns || this.columns.trim() === '*') return rows.map((row) => ({ ...row }));
    const names = this.columns.split(',').map((name) => name.trim()).filter(Boolean);
    for (const name of names) this.column(name);
    return rows.map((row) => Object.fromEntries(names.map((name) => [name, row[name] ?? null])));
  }

  private shape(rows: Row[]): { data: unknown; error: DbError | null } {
    if (this.mode === 'many') return { data: rows, error: null };
    if (rows.length > 1) return { data: null, error: dbError('PGRST116', 'JSON object requested, multiple (or no) rows returned') };
    if (this.mode === 'one' && rows.length === 0) return { data: null, error: dbError('PGRST116', 'JSON object requested, multiple (or no) rows returned') };
    return { data: rows[0] ?? null, error: null };
  }

  private async execute(): Promise<{ data: unknown; error: DbError | null; count?: number | null }> {
    this.db.queries.push({ table: this.table, op: this.op, columns: this.columns, eq: [...this.eqFilters] });
    const failure = this.db.takeFailure(this.table, this.op);
    if (failure) return { data: null, error: failure, count: null };

    const all = this.db.tables[this.table];
    const matched = all.filter((row) => this.filters.every((filter) => filter(row)));

    if (this.op === 'select') {
      let rows = [...matched];
      if (this.orderBy.length) {
        rows.sort((a, b) => {
          for (const { column, ascending } of this.orderBy) {
            const difference = compare(this.column(column), a[column], b[column]);
            if (difference !== 0) return ascending ? difference : -difference;
          }
          return 0;
        });
      }
      if (this.limitTo !== null) rows = rows.slice(0, this.limitTo);
      if (this.head) return { data: null, error: null, count: this.counted ? matched.length : null };
      const shaped = this.shape(this.project(rows));
      return this.counted ? { ...shaped, count: matched.length } : shaped;
    }

    if (this.op === 'insert') {
      const input = Array.isArray(this.payload) ? this.payload : [this.payload ?? {}];
      const result = this.db.insertRows(this.table, input);
      if (result.error) return { data: null, error: result.error };
      return this.returning ? this.shape(this.project(result.data ?? [])) : { data: null, error: null };
    }

    if (this.op === 'update') {
      const values = (this.payload ?? {}) as Row;
      const candidates = matched.map((row) => ({ row, next: { ...row, ...values } }));
      for (const { row, next } of candidates) {
        const error = this.db.validate(this.table, next) ?? this.db.conflicts(this.table, next, row);
        if (error) return { data: null, error };
      }
      for (const { row, next } of candidates) Object.assign(row, next);
      this.db.writes.push({ table: this.table, op: 'update', rows: candidates.map(({ next }) => ({ ...next })) });
      return this.returning ? this.shape(this.project(candidates.map(({ row }) => row))) : { data: null, error: null };
    }

    // delete
    this.db.tables[this.table] = all.filter((row) => !matched.includes(row));
    this.db.writes.push({ table: this.table, op: 'delete', rows: matched.map((row) => ({ ...row })) });
    return this.returning ? this.shape(this.project(matched)) : { data: null, error: null };
  }
}
