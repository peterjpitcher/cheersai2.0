import { randomUUID } from 'node:crypto';

import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * In-memory stand-in for the Supabase query builder, for the Facebook and
 * Instagram connection flow (OAuth callback, Page chooser, disconnect).
 *
 * It enforces the live constraints of the tables that flow writes (checked
 * against production on 2026-09-29 with SELECT-only queries): NOT NULL
 * columns, CHECK lists, primary and unique keys, foreign keys, and unknown
 * columns. A write production would refuse is refused here with the same
 * Postgres error code, so a test cannot pass on a row production would reject.
 * Columns marked strictUuid also refuse, in writes and eq filters, a value
 * Postgres cannot read as a uuid (22P02).
 *
 * Supports: select, insert, update, upsert (onConflict), delete, eq, is, gt,
 * in, order, returns, maybeSingle, single, and .select() after a write.
 * Failures can be injected per table and operation to simulate an outage.
 */

type Row = Record<string, unknown>;
type ColumnType = 'uuid' | 'text' | 'timestamptz' | 'jsonb' | 'text[]' | 'integer';
export type Op = 'select' | 'insert' | 'update' | 'upsert' | 'delete';

interface ColumnSpec {
  type: ColumnType;
  notNull?: boolean;
  default?: () => unknown;
  check?: readonly unknown[];
  /**
   * The value must be uuid text, as Postgres requires. Opt-in because older
   * fixtures use readable ids in other uuid columns.
   */
  strictUuid?: boolean;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function uuidError(value: unknown): DbError | null {
  if (value === null || value === undefined || UUID_PATTERN.test(String(value))) return null;
  return dbError('22P02', `invalid input syntax for type uuid: "${String(value)}"`);
}

interface TableSpec {
  columns: Record<string, ColumnSpec>;
  primaryKey: string[];
  unique?: string[][];
  foreignKeys?: Array<{ column: string; table: string; references: string }>;
  /** BEFORE UPDATE trigger set_updated_at. */
  touchesUpdatedAt?: boolean;
}

const now = (): string => new Date().toISOString();
const PROVIDERS = ['facebook', 'instagram', 'gbp'] as const;

export const CONNECTIONS_SCHEMA: Record<string, TableSpec> = {
  accounts: {
    columns: {
      id: { type: 'uuid', notNull: true },
      business_name: { type: 'text' },
    },
    primaryKey: ['id'],
  },
  oauth_states: {
    columns: {
      id: { type: 'uuid', notNull: true, default: () => randomUUID() },
      provider: { type: 'text', notNull: true, check: PROVIDERS },
      state: { type: 'text', notNull: true },
      redirect_to: { type: 'text' },
      code_verifier: { type: 'text' },
      auth_code: { type: 'text' },
      error: { type: 'text' },
      created_at: { type: 'timestamptz', notNull: true, default: now },
      used_at: { type: 'timestamptz' },
      account_id: { type: 'uuid' },
      // The signed-in user's id (auth.users), which only they can finish a flow with.
      created_by: { type: 'uuid', strictUuid: true },
      expires_at: { type: 'timestamptz', default: () => new Date(Date.now() + 10 * 60 * 1000).toISOString() },
    },
    primaryKey: ['id'],
    unique: [['state']],
    foreignKeys: [{ column: 'account_id', table: 'accounts', references: 'id' }],
  },
  social_connections: {
    columns: {
      id: { type: 'uuid', notNull: true, default: () => randomUUID() },
      account_id: { type: 'uuid', notNull: true },
      provider: { type: 'text', notNull: true, check: PROVIDERS },
      status: { type: 'text', notNull: true, default: () => 'needs_action', check: ['active', 'expiring', 'needs_action'] },
      access_token: { type: 'text' },
      refresh_token: { type: 'text' },
      expires_at: { type: 'timestamptz' },
      display_name: { type: 'text' },
      last_synced_at: { type: 'timestamptz' },
      created_at: { type: 'timestamptz', notNull: true, default: now },
      updated_at: { type: 'timestamptz', notNull: true, default: now },
      metadata: { type: 'jsonb' },
      platform_account_id: { type: 'text' },
      platform_account_name: { type: 'text' },
      scopes: { type: 'text[]' },
      token_expires_at: { type: 'timestamptz' },
      meta_user_id: { type: 'text' },
    },
    primaryKey: ['id'],
    unique: [['account_id', 'provider']],
    foreignKeys: [{ column: 'account_id', table: 'accounts', references: 'id' }],
    touchesUpdatedAt: true,
  },
  token_vault: {
    columns: {
      id: { type: 'uuid', notNull: true, default: () => randomUUID() },
      social_connection_id: { type: 'uuid', notNull: true },
      token_type: { type: 'text', notNull: true, check: ['access', 'refresh'] },
      ciphertext: { type: 'text', notNull: true },
      iv: { type: 'text', notNull: true },
      tag: { type: 'text', notNull: true },
      key_version: { type: 'integer', notNull: true, default: () => 1 },
      created_at: { type: 'timestamptz', notNull: true, default: now },
      updated_at: { type: 'timestamptz', notNull: true, default: now },
    },
    primaryKey: ['id'],
    unique: [['social_connection_id', 'token_type']],
    foreignKeys: [{ column: 'social_connection_id', table: 'social_connections', references: 'id' }],
  },
};

export interface DbError {
  code: string;
  message: string;
}

function dbError(code: string, message: string): DbError {
  return { code, message };
}

type Result = { data: unknown; error: DbError | null };

export class InMemoryConnectionsDb {
  tables: Record<string, Row[]> = Object.fromEntries(Object.keys(CONNECTIONS_SCHEMA).map((name) => [name, []]));
  private failures: Array<{ table: string; op: Op; error: DbError; times: number; skip: number }> = [];
  /** Every query, with its equality filters, for brand-scoping assertions. */
  queries: Array<{ table: string; op: Op; eq: Array<[string, unknown]> }> = [];
  /** Writes, and uuid filters, production would have refused. */
  rejected: DbError[] = [];

  seed(table: string, rows: Row[]): void {
    for (const row of rows) {
      const result = this.insertRow(table, row);
      if (result.error) throw new Error(`seed ${table} failed: ${result.error.message}`);
    }
  }

  rows(table: string): Row[] {
    return this.tables[table].map((row) => ({ ...row }));
  }

  /**
   * Make `times` calls of `op` on `table` fail like an outage, after letting
   * the first `skip` calls through.
   */
  fail(table: string, op: Op, times = Number.POSITIVE_INFINITY, { skip = 0, message = 'connection refused', code = '08006' } = {}): void {
    this.failures.push({ table, op, error: dbError(code, message), times, skip });
  }

  takeFailure(table: string, op: Op): DbError | null {
    const failure = this.failures.find((f) => f.table === table && f.op === op && f.times > 0);
    if (!failure) return null;
    if (failure.skip > 0) {
      failure.skip -= 1;
      return null;
    }
    failure.times -= 1;
    return failure.error;
  }

  client(): SupabaseClient {
    return { from: (table: string) => new Query(this, table) } as unknown as SupabaseClient;
  }

  spec(table: string): TableSpec {
    const spec = CONNECTIONS_SCHEMA[table];
    if (!spec) throw new Error(`in-memory db: unknown table ${table}`);
    return spec;
  }

  validate(table: string, row: Row, ignore: Row | null): DbError | null {
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
      if (value !== null && value !== undefined && rule.type === 'text[]' && !Array.isArray(value)) {
        return dbError('22P02', `malformed array literal: "${String(value)}"`);
      }
      if (rule.strictUuid) {
        const error = uuidError(value);
        if (error) return error;
      }
    }
    for (const fk of spec.foreignKeys ?? []) {
      const value = row[fk.column];
      if (value === null || value === undefined) continue;
      if (!this.tables[fk.table].some((other) => other[fk.references] === value)) {
        return dbError('23503', `insert or update on table "${table}" violates foreign key constraint "${table}_${fk.column}_fkey"`);
      }
    }
    for (const key of [spec.primaryKey, ...(spec.unique ?? [])]) {
      const clash = this.tables[table].some((other) => other !== ignore && key.every((column) => other[column] === row[column]));
      if (clash) return dbError('23505', `duplicate key value violates unique constraint "${table}_${key.join('_')}_key"`);
    }
    return null;
  }

  insertRow(table: string, raw: Row): { data: Row | null; error: DbError | null } {
    const spec = this.spec(table);
    const row: Row = { ...raw };
    for (const [column, rule] of Object.entries(spec.columns)) {
      if (row[column] === undefined) row[column] = rule.default ? rule.default() : null;
    }
    const error = this.validate(table, row, null);
    if (error) {
      this.rejected.push(error);
      return { data: null, error };
    }
    this.tables[table].push(row);
    return { data: { ...row }, error: null };
  }

  /** The row as an UPDATE would leave it, or the error production would raise. */
  prepareUpdate(table: string, row: Row, values: Row): { next: Row; error: DbError | null } {
    const next: Row = { ...row, ...values };
    if (this.spec(table).touchesUpdatedAt) next.updated_at = now();
    const error = this.validate(table, next, row);
    if (error) this.rejected.push(error);
    return { next, error };
  }
}

type Filter = (row: Row) => boolean;

class Query implements PromiseLike<Result> {
  private op: Op = 'select';
  private filters: Filter[] = [];
  private eqFilters: Array<[string, unknown]> = [];
  private payload: Row | null = null;
  private onConflict: string[] = [];
  private returning = false;
  private columns: string | null = null;
  private mode: 'many' | 'maybe' | 'one' = 'many';
  /** A filter value Postgres would refuse to parse: the whole statement fails. */
  private filterError: DbError | null = null;

  constructor(
    private readonly db: InMemoryConnectionsDb,
    private readonly table: string,
  ) {
    db.spec(table);
  }

  select(columns?: string): this {
    if (this.op === 'select') {
      this.columns = columns ?? '*';
    } else {
      this.returning = true;
      this.columns = columns ?? '*';
    }
    return this;
  }

  insert(row: Row): this {
    this.op = 'insert';
    this.payload = row;
    return this;
  }

  update(values: Row): this {
    this.op = 'update';
    this.payload = values;
    return this;
  }

  upsert(row: Row, options?: { onConflict?: string }): this {
    this.op = 'upsert';
    this.payload = row;
    this.onConflict = (options?.onConflict ?? this.db.spec(this.table).primaryKey.join(','))
      .split(',')
      .map((column) => column.trim());
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
    if (this.column(column).strictUuid) this.filterError ??= uuidError(value);
    this.eqFilters.push([column, value]);
    this.filters.push((row) => row[column] === value);
    return this;
  }

  is(column: string, value: null): this {
    this.column(column);
    this.filters.push((row) => row[column] === value || (value === null && row[column] === undefined));
    return this;
  }

  gt(column: string, value: string): this {
    this.column(column);
    this.filters.push((row) => row[column] !== null && row[column] !== undefined && Date.parse(String(row[column])) > Date.parse(value));
    return this;
  }

  in(column: string, values: unknown[]): this {
    this.column(column);
    this.filters.push((row) => values.includes(row[column]));
    return this;
  }

  order(column: string): this {
    this.column(column);
    return this;
  }

  returns(): this {
    return this;
  }

  maybeSingle(): Promise<Result> {
    this.mode = 'maybe';
    return this.execute();
  }

  single(): Promise<Result> {
    this.mode = 'one';
    return this.execute();
  }

  then<TResult1 = Result, TResult2 = never>(
    onfulfilled?: ((value: Result) => TResult1 | PromiseLike<TResult1>) | null,
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

  private shape(rows: Row[]): Result {
    if (this.mode === 'many') return { data: rows, error: null };
    if (rows.length > 1 || (this.mode === 'one' && rows.length === 0)) {
      return { data: null, error: dbError('PGRST116', 'JSON object requested, multiple (or no) rows returned') };
    }
    return { data: rows[0] ?? null, error: null };
  }

  private async execute(): Promise<Result> {
    this.db.queries.push({ table: this.table, op: this.op, eq: [...this.eqFilters] });
    const failure = this.db.takeFailure(this.table, this.op);
    if (failure) return { data: null, error: failure };
    if (this.filterError) {
      this.db.rejected.push(this.filterError);
      return { data: null, error: this.filterError };
    }

    const all = this.db.tables[this.table];
    const matched = all.filter((row) => this.filters.every((filter) => filter(row)));

    if (this.op === 'select') {
      return this.shape(this.project(matched));
    }

    if (this.op === 'insert') {
      const result = this.db.insertRow(this.table, this.payload ?? {});
      if (result.error) return { data: null, error: result.error };
      return this.returning ? this.shape(this.project([result.data as Row])) : { data: null, error: null };
    }

    if (this.op === 'upsert') {
      const payload = this.payload ?? {};
      const existing = all.find((row) => this.onConflict.every((column) => row[column] === payload[column]));
      if (existing) {
        const { next, error } = this.db.prepareUpdate(this.table, existing, payload);
        if (error) return { data: null, error };
        Object.assign(existing, next);
        return this.returning ? this.shape(this.project([existing])) : { data: null, error: null };
      }
      const result = this.db.insertRow(this.table, payload);
      if (result.error) return { data: null, error: result.error };
      return this.returning ? this.shape(this.project([result.data as Row])) : { data: null, error: null };
    }

    if (this.op === 'update') {
      // All or nothing, like a single UPDATE statement.
      const prepared = matched.map((row) => ({ row, ...this.db.prepareUpdate(this.table, row, this.payload ?? {}) }));
      const failed = prepared.find((entry) => entry.error);
      if (failed) return { data: null, error: failed.error };
      for (const { row, next } of prepared) Object.assign(row, next);
      return this.returning ? this.shape(this.project(matched)) : { data: null, error: null };
    }

    // delete
    this.db.tables[this.table] = all.filter((row) => !matched.includes(row));
    return this.returning ? this.shape(this.project(matched)) : { data: null, error: null };
  }
}
