declare module 'pg' {
  export interface QueryResult<T = any> {
    rows: T[]
    rowCount?: number
    command?: string
  }

  export class Client {
    constructor(config?: { connectionString?: string } & Record<string, any>)
    connect(): Promise<void>
    end(): Promise<void>
    query<T = any>(queryText: string, params?: any[]): Promise<QueryResult<T>>
  }
}

