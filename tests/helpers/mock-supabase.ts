import { vi } from "vitest";

type TableName = "social_connections" | "oauth_states" | "notifications" | "accounts";
type Row = Record<string, any>;

export class InMemorySupabase {
  store: Record<TableName, Row[]> = {
    social_connections: [],
    oauth_states: [],
    notifications: [],
    accounts: [],
  };

  getClient() {
    return {
      from: (table: TableName) => {
        return {
          select: (columns: string) => ({
            eq: (col: string, val: any) => ({
              maybeSingle: async () => {
                const row = this.store[table].find((r) => r[col] === val);
                return { data: row ?? null, error: null };
              },
              single: async () => {
                const row = this.store[table].find((r) => r[col] === val);
                return { data: row ?? null, error: row ? null : { message: "Not found" } };
              },
            }),
          }),
          update: (updates: Row) => ({
            eq: async (col: string, val: any) => {
              const rows = this.store[table].filter((r) => r[col] === val);
              rows.forEach((r) => Object.assign(r, updates));
              return { error: null };
            },
          }),
          insert: async (row: Row) => {
            this.store[table].push(row);
            return { error: null };
          },
          delete: () => ({
            lte: () => ({
               // Simplified delete for cleanup jobs
               eq: async () => ({ error: null }),
               is: async () => ({ error: null }),
               not: async () => ({ error: null }),
            })
          })
        };
      },
    };
  }

  seed(table: TableName, rows: Row[]) {
    this.store[table].push(...rows);
  }
}
