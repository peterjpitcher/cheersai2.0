import { randomUUID } from 'node:crypto';

import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * In-memory stand-in for the Supabase query builder, for Google versions
 * (src/lib/google-posts). It enforces what production would: NOT NULL
 * columns, unknown columns, every CHECK in
 * supabase/migrations/20261116111647_gbp_posts_attached_versions.sql and
 * 20261114211618_gbp_posts_and_switch.sql (including the cross-column ones),
 * the unique indexes (including the partial one-per-event index) and foreign
 * keys. A write production would refuse is refused here with the same
 * Postgres error code, so a test cannot pass on a row production would reject.
 *
 * Supports: select, insert, update, delete, eq, neq, is, in, gt, gte, lt, lte,
 * order, limit, returns, maybeSingle, single, .select() after a write, and
 * storage.from(bucket).createSignedUrl. Failures can be injected per table
 * and operation.
 */

type Row = Record<string, unknown>;
export type Op = 'select' | 'insert' | 'update' | 'delete';

interface ColumnSpec {
  notNull?: boolean;
  default?: () => unknown;
}

interface TableSpec {
  columns: Record<string, ColumnSpec>;
  primaryKey: string[];
  unique?: Array<{ name: string; columns: string[]; where?: (row: Row) => boolean }>;
  checks?: Array<{ name: string; test: (row: Row) => boolean }>;
  foreignKeys?: Array<{ column: string; table: string; references: string }>;
}

const now = (): string => new Date().toISOString();
const uuid = (): string => randomUUID();
const isNull = (value: unknown): boolean => value === null || value === undefined;
const nonBlank = (value: unknown): boolean => typeof value === 'string' && value.trim().length > 0;

/** CHECK semantics: a NULL result passes, so each test returns true for "passes or NULL". */
const GBP_POSTS_CHECKS: TableSpec['checks'] = [
  { name: 'gbp_posts_delivery_state_check', test: (r) => ['not_scheduled', 'claimed', 'sent', 'uncertain', 'failed'].includes(String(r.delivery_state)) },
  { name: 'gbp_posts_check_attempts_check', test: (r) => Number(r.check_attempts) >= 0 },
  { name: 'gbp_posts_source_event_key_check', test: (r) => isNull(r.source_event_key) || /^(mgmt|campaign):.+/.test(String(r.source_event_key)) },
  { name: 'gbp_posts_local_post_parent_check', test: (r) => /^accounts\/[^/]+\/locations\/[^/]+$/.test(String(r.local_post_parent)) },
  { name: 'gbp_posts_state_check', test: (r) => ['pending', 'held', 'claimed', 'sent', 'uncertain', 'failed', 'skipped'].includes(String(r.state)) },
  { name: 'gbp_posts_topic_type_check', test: (r) => ['STANDARD', 'EVENT'].includes(String(r.topic_type)) },
  { name: 'gbp_posts_cta_type_check', test: (r) => isNull(r.cta_type) || ['BOOK', 'LEARN_MORE'].includes(String(r.cta_type)) },
  {
    name: 'gbp_posts_cta_pair_check',
    test: (r) => (isNull(r.cta_type) && isNull(r.cta_url)) || (!isNull(r.cta_type) && !isNull(r.cta_url) && /^https:\/\//.test(String(r.cta_url))),
  },
  {
    name: 'gbp_posts_event_fields_check',
    test: (r) =>
      r.topic_type !== 'EVENT' ||
      (nonBlank(r.event_title) && !isNull(r.event_start) && !isNull(r.event_end) && Date.parse(String(r.event_end)) > Date.parse(String(r.event_start))),
  },
  { name: 'gbp_posts_held_reason_check', test: (r) => r.state !== 'held' || nonBlank(r.hold_reason) },
  { name: 'gbp_posts_claimed_at_check', test: (r) => !['claimed', 'uncertain'].includes(String(r.state)) || !isNull(r.claimed_at) },
  { name: 'gbp_posts_sent_fields_check', test: (r) => r.state !== 'sent' || (!isNull(r.google_post_name) && !isNull(r.sent_at)) },
  { name: 'gbp_posts_summary_length_check', test: (r) => Array.from(String(r.summary)).length <= 1500 },
  { name: 'gbp_posts_attempts_check', test: (r) => Number(r.attempts) >= 0 },
  { name: 'gbp_posts_resend_count_check', test: (r) => Number(r.resend_count) >= 0 && Number(r.resend_count) <= 1 },
  { name: 'gbp_posts_wording_source_check', test: (r) => ['awaiting_ai', 'ai', 'facebook', 'person'].includes(String(r.wording_source)) },
  { name: 'gbp_posts_wording_attempts_check', test: (r) => Number(r.wording_attempts) >= 0 },
];

export const GOOGLE_POSTS_SCHEMA: Record<string, TableSpec> = {
  accounts: {
    columns: {
      id: { notNull: true },
      business_name: {},
      display_name: {},
      google_posts_enabled: { notNull: true, default: () => false },
      management_import_enabled: { notNull: true, default: () => false },
    },
    primaryKey: ['id'],
  },
  social_connections: {
    columns: {
      id: { notNull: true, default: uuid },
      account_id: { notNull: true },
      provider: { notNull: true },
      status: { notNull: true, default: () => 'needs_action' },
      platform_account_id: {},
      metadata: {},
      token_expires_at: {},
      created_at: { notNull: true, default: now },
      updated_at: { notNull: true, default: now },
    },
    primaryKey: ['id'],
    unique: [{ name: 'social_connections_account_provider', columns: ['account_id', 'provider'] }],
    checks: [
      { name: 'social_connections_status_check', test: (r) => ['active', 'expiring', 'needs_action'].includes(String(r.status)) },
      { name: 'social_connections_provider_check', test: (r) => ['facebook', 'instagram', 'gbp'].includes(String(r.provider)) },
    ],
    foreignKeys: [{ column: 'account_id', table: 'accounts', references: 'id' }],
  },
  campaigns: {
    columns: {
      id: { notNull: true, default: uuid },
      account_id: { notNull: true },
      name: { notNull: true },
      campaign_type: { notNull: true },
      status: { notNull: true, default: () => 'scheduled' },
      metadata: {},
      created_at: { notNull: true, default: now },
    },
    primaryKey: ['id'],
    foreignKeys: [{ column: 'account_id', table: 'accounts', references: 'id' }],
  },
  content_items: {
    columns: {
      id: { notNull: true, default: uuid },
      campaign_id: {},
      account_id: { notNull: true },
      platform: {},
      placement: { notNull: true, default: () => 'feed' },
      status: { notNull: true, default: () => 'draft' },
      scheduled_for: {},
      deleted_at: {},
      created_at: { notNull: true, default: now },
      updated_at: { notNull: true, default: now },
    },
    primaryKey: ['id'],
    checks: [
      {
        name: 'content_items_status_check',
        test: (r) => ['draft', 'scheduled', 'queued', 'publishing', 'posted', 'failed'].includes(String(r.status)),
      },
      { name: 'content_items_placement_check', test: (r) => ['feed', 'story'].includes(String(r.placement)) },
    ],
    foreignKeys: [
      { column: 'account_id', table: 'accounts', references: 'id' },
      { column: 'campaign_id', table: 'campaigns', references: 'id' },
    ],
  },
  content_variants: {
    columns: {
      id: { notNull: true, default: uuid },
      content_item_id: { notNull: true },
      body: {},
      media_ids: { default: () => [] },
      updated_at: { notNull: true, default: now },
    },
    primaryKey: ['id'],
    foreignKeys: [{ column: 'content_item_id', table: 'content_items', references: 'id' }],
  },
  media_assets: {
    columns: {
      id: { notNull: true, default: uuid },
      account_id: { notNull: true },
      storage_path: { notNull: true },
      file_name: { notNull: true, default: () => 'file' },
      media_type: { notNull: true },
      mime_type: {},
      size_bytes: {},
      derived_variants: { default: () => ({}) },
    },
    primaryKey: ['id'],
    foreignKeys: [{ column: 'account_id', table: 'accounts', references: 'id' }],
  },
  management_app_connections: {
    columns: {
      account_id: { notNull: true },
      base_url: { notNull: true },
      api_key: { notNull: true },
      enabled: { notNull: true, default: () => true },
    },
    primaryKey: ['account_id'],
  },
  notifications: {
    columns: {
      id: { notNull: true, default: uuid },
      account_id: { notNull: true },
      category: {},
      message: { notNull: true },
      title: {},
      body: {},
      urgency: { default: () => 'standard' },
      resource_type: {},
      resource_id: {},
      metadata: {},
      read_at: {},
      dismissed_at: {},
      created_at: { notNull: true, default: now },
    },
    primaryKey: ['id'],
    checks: [
      { name: 'notifications_resource_id_uuid', test: (r) => isNull(r.resource_id) || /^[0-9a-f-]{36}$/i.test(String(r.resource_id)) },
    ],
  },
  gbp_posts: {
    columns: {
      id: { notNull: true, default: uuid },
      account_id: { notNull: true },
      content_item_id: { notNull: true },
      publish_job_id: {},
      source_event_key: {},
      local_post_parent: { notNull: true },
      google_post_name: {},
      search_url: {},
      google_state: {},
      delivery_state: { notNull: true, default: () => 'not_scheduled' },
      last_checked_at: {},
      next_check_at: {},
      check_attempts: { notNull: true, default: () => 0 },
      last_error: {},
      created_at: { notNull: true, default: now },
      updated_at: { notNull: true, default: now },
      state: { notNull: true, default: () => 'pending' },
      hold_reason: {},
      topic_type: { notNull: true, default: () => 'STANDARD' },
      summary: { notNull: true, default: () => '' },
      cta_type: {},
      cta_url: {},
      event_title: {},
      event_start: {},
      event_end: {},
      attempts: { notNull: true, default: () => 0 },
      next_attempt_at: {},
      claimed_at: {},
      sent_at: {},
      summary_edited_at: {},
      resend_count: { notNull: true, default: () => 0 },
      scheduled_for: {},
      wording_source: { notNull: true, default: () => 'awaiting_ai' },
      wording_attempts: { notNull: true, default: () => 0 },
    },
    primaryKey: ['id'],
    unique: [
      { name: 'gbp_posts_content_item_key', columns: ['content_item_id'] },
      {
        name: 'gbp_posts_one_per_event',
        columns: ['account_id', 'source_event_key', 'local_post_parent'],
        where: (r) => !isNull(r.source_event_key),
      },
    ],
    checks: GBP_POSTS_CHECKS,
    foreignKeys: [
      { column: 'account_id', table: 'accounts', references: 'id' },
      { column: 'content_item_id', table: 'content_items', references: 'id' },
    ],
  },
};

export interface DbError {
  code: string;
  message: string;
}

const dbError = (code: string, message: string): DbError => ({ code, message });

type Result = { data: unknown; error: DbError | null };

export class InMemoryGooglePostsDb {
  tables: Record<string, Row[]> = Object.fromEntries(Object.keys(GOOGLE_POSTS_SCHEMA).map((name) => [name, []]));
  private failures: Array<{ table: string; op: Op; error: DbError; times: number }> = [];
  /** Every query with its equality filters, for brand-scoping assertions. */
  queries: Array<{ table: string; op: Op; eq: Array<[string, unknown]> }> = [];
  /** Writes production would have refused. */
  rejected: DbError[] = [];
  /** Paths signed, and for how long. */
  signed: Array<{ bucket: string; path: string; expiresIn: number }> = [];
  signFails = false;
  /** Runs before each update is applied (to simulate another writer racing). */
  beforeUpdate: ((table: string) => void) | null = null;
  /** The clock column defaults (created_at, updated_at) read; tests point it at their fake clock. */
  clock: () => Date = () => new Date();

  seed(table: string, rows: Row[]): void {
    for (const row of rows) {
      const result = this.insertRow(table, row);
      if (result.error) throw new Error(`seed ${table} failed: ${result.error.message}`);
    }
  }

  rows(table: string): Row[] {
    return this.tables[table].map((row) => ({ ...row }));
  }

  fail(table: string, op: Op, times = Number.POSITIVE_INFINITY, { message = 'connection refused', code = '08006' } = {}): void {
    this.failures.push({ table, op, error: dbError(code, message), times });
  }

  takeFailure(table: string, op: Op): DbError | null {
    const failure = this.failures.find((f) => f.table === table && f.op === op && f.times > 0);
    if (!failure) return null;
    failure.times -= 1;
    return failure.error;
  }

  client(): SupabaseClient {
    return {
      from: (table: string) => new Query(this, table),
      storage: {
        from: (bucket: string) => ({
          createSignedUrl: async (path: string, expiresIn: number) => {
            if (this.signFails) return { data: null, error: { message: 'storage unavailable' } };
            this.signed.push({ bucket, path, expiresIn });
            return { data: { signedUrl: `https://storage.example/${bucket}/${path}?token=signed-secret-token` }, error: null };
          },
        }),
      },
    } as unknown as SupabaseClient;
  }

  spec(table: string): TableSpec {
    const spec = GOOGLE_POSTS_SCHEMA[table];
    if (!spec) throw new Error(`in-memory db: unknown table ${table}`);
    return spec;
  }

  validate(table: string, row: Row, ignore: Row | null): DbError | null {
    const spec = this.spec(table);
    for (const column of Object.keys(row)) {
      if (!(column in spec.columns)) return dbError('42703', `column "${column}" of relation "${table}" does not exist`);
    }
    for (const [column, rule] of Object.entries(spec.columns)) {
      if (rule.notNull && isNull(row[column])) {
        return dbError('23502', `null value in column "${column}" of relation "${table}" violates not-null constraint`);
      }
    }
    for (const check of spec.checks ?? []) {
      if (!check.test(row)) return dbError('23514', `new row for relation "${table}" violates check constraint "${check.name}"`);
    }
    for (const fk of spec.foreignKeys ?? []) {
      const value = row[fk.column];
      if (isNull(value)) continue;
      if (!this.tables[fk.table].some((other) => other[fk.references] === value)) {
        return dbError('23503', `insert or update on table "${table}" violates foreign key constraint "${table}_${fk.column}_fkey"`);
      }
    }
    const keys = [{ name: `${table}_pkey`, columns: spec.primaryKey }, ...(spec.unique ?? [])];
    for (const key of keys) {
      if ('where' in key && key.where && !key.where(row)) continue;
      const clash = this.tables[table].some(
        (other) =>
          other !== ignore &&
          (!('where' in key) || !key.where || key.where(other)) &&
          key.columns.every((column) => other[column] === row[column]),
      );
      if (clash) return dbError('23505', `duplicate key value violates unique constraint "${key.name}"`);
    }
    return null;
  }

  insertRow(table: string, raw: Row): { data: Row | null; error: DbError | null } {
    const spec = this.spec(table);
    const row: Row = { ...raw };
    for (const [column, rule] of Object.entries(spec.columns)) {
      if (row[column] === undefined) {
        row[column] = rule.default === now ? this.clock().toISOString() : rule.default ? rule.default() : null;
      }
    }
    const error = this.validate(table, row, null);
    if (error) {
      this.rejected.push(error);
      return { data: null, error };
    }
    this.tables[table].push(row);
    return { data: { ...row }, error: null };
  }
}

type Filter = (row: Row) => boolean;

const compare = (a: unknown, b: unknown): number => {
  const left = typeof a === 'string' && !Number.isNaN(Date.parse(a)) && /\d{4}-\d{2}-\d{2}T/.test(a) ? Date.parse(a) : a;
  const right = typeof b === 'string' && !Number.isNaN(Date.parse(b)) && /\d{4}-\d{2}-\d{2}T/.test(b) ? Date.parse(b) : b;
  if (left === right) return 0;
  return (left as number) < (right as number) ? -1 : 1;
};

class Query implements PromiseLike<Result> {
  private op: Op = 'select';
  private filters: Filter[] = [];
  private eqFilters: Array<[string, unknown]> = [];
  private payload: Row | Row[] | null = null;
  private returning = false;
  private columns: string | null = null;
  private mode: 'many' | 'maybe' | 'one' = 'many';
  private orderBy: Array<{ column: string; ascending: boolean }> = [];
  private limitTo: number | null = null;

  constructor(
    private readonly db: InMemoryGooglePostsDb,
    private readonly table: string,
  ) {
    db.spec(table);
  }

  private column(name: string): void {
    if (!(name in this.db.spec(this.table).columns)) throw new Error(`in-memory db: unknown column ${this.table}.${name}`);
  }

  select(columns?: string): this {
    if (this.op !== 'select') this.returning = true;
    this.columns = columns ?? '*';
    return this;
  }

  insert(row: Row | Row[]): this {
    this.op = 'insert';
    this.payload = row;
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

  eq(column: string, value: unknown): this {
    this.column(column);
    this.eqFilters.push([column, value]);
    this.filters.push((row) => row[column] === value);
    return this;
  }

  neq(column: string, value: unknown): this {
    this.column(column);
    this.filters.push((row) => !isNull(row[column]) && row[column] !== value);
    return this;
  }

  is(column: string, value: null | boolean): this {
    this.column(column);
    this.filters.push((row) => (value === null ? isNull(row[column]) : row[column] === value));
    return this;
  }

  in(column: string, values: unknown[]): this {
    this.column(column);
    this.filters.push((row) => values.includes(row[column]));
    return this;
  }

  private range(column: string, test: (order: number) => boolean, value: unknown): this {
    this.column(column);
    this.filters.push((row) => !isNull(row[column]) && test(compare(row[column], value)));
    return this;
  }

  gt(column: string, value: unknown): this {
    return this.range(column, (o) => o > 0, value);
  }

  gte(column: string, value: unknown): this {
    return this.range(column, (o) => o >= 0, value);
  }

  lt(column: string, value: unknown): this {
    return this.range(column, (o) => o < 0, value);
  }

  lte(column: string, value: unknown): this {
    return this.range(column, (o) => o <= 0, value);
  }

  order(column: string, options?: { ascending?: boolean }): this {
    this.column(column);
    this.orderBy.push({ column, ascending: options?.ascending !== false });
    return this;
  }

  limit(count: number): this {
    this.limitTo = count;
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
    // A real round trip yields, so racing callers interleave as they would in production.
    await Promise.resolve();
    this.db.queries.push({ table: this.table, op: this.op, eq: [...this.eqFilters] });
    const failure = this.db.takeFailure(this.table, this.op);
    if (failure) return { data: null, error: failure };

    if (this.op === 'insert') {
      const rows = Array.isArray(this.payload) ? this.payload : [this.payload ?? {}];
      const inserted: Row[] = [];
      for (const raw of rows) {
        const result = this.db.insertRow(this.table, raw);
        if (result.error) {
          // All or nothing, like one INSERT statement.
          this.db.tables[this.table] = this.db.tables[this.table].filter((row) => !inserted.some((done) => done.id === row.id));
          return { data: null, error: result.error };
        }
        inserted.push(result.data as Row);
      }
      return this.returning ? this.shape(this.project(inserted)) : { data: null, error: null };
    }

    if (this.op === 'update') this.db.beforeUpdate?.(this.table);

    const all = this.db.tables[this.table];
    let matched = all.filter((row) => this.filters.every((filter) => filter(row)));
    for (const { column, ascending } of [...this.orderBy].reverse()) {
      matched = [...matched].sort((a, b) => (ascending ? 1 : -1) * compare(a[column] ?? '', b[column] ?? ''));
    }
    if (this.limitTo !== null) matched = matched.slice(0, this.limitTo);

    if (this.op === 'select') return this.shape(this.project(matched));

    if (this.op === 'update') {
      const values = (this.payload ?? {}) as Row;
      const prepared = matched.map((row) => {
        const next = { ...row, ...values };
        const error = this.db.validate(this.table, next, row);
        return { row, next, error };
      });
      const failed = prepared.find((entry) => entry.error);
      if (failed?.error) {
        this.db.rejected.push(failed.error);
        return { data: null, error: failed.error };
      }
      for (const { row, next } of prepared) Object.assign(row, next);
      return this.returning ? this.shape(this.project(matched)) : { data: null, error: null };
    }

    this.db.tables[this.table] = all.filter((row) => !matched.includes(row));
    return this.returning ? this.shape(this.project(matched)) : { data: null, error: null };
  }
}
