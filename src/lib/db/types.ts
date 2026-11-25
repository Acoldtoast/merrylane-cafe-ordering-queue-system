export interface RunResult {
  changes: number;
  lastInsertRowid?: number;
}

export interface DatabaseStatement {
  all<T extends Record<string, unknown> = Record<string, unknown>>(
    ...parameters: unknown[]
  ): Promise<T[]>;
  get<T extends Record<string, unknown> = Record<string, unknown>>(
    ...parameters: unknown[]
  ): Promise<T | undefined>;
  run(...parameters: unknown[]): Promise<RunResult>;
}

export interface Database {
  prepare(sql: string): DatabaseStatement;
  all<T extends Record<string, unknown>>(
    sql: string,
    parameters: unknown[]
  ): Promise<T[]>;
  get<T extends Record<string, unknown>>(
    sql: string,
    parameters: unknown[]
  ): Promise<T | undefined>;
  run(sql: string, parameters: unknown[]): Promise<RunResult>;
  exec(sql: string): Promise<void>;
  transaction<T>(callback: (database: Database) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}
