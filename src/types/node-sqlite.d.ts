/**
 * Minimal ambient types for Node's built-in SQLite module.
 * @types/node v20 does not ship declarations for node:sqlite yet.
 */
declare module "node:sqlite" {
  export interface StatementResult {
    changes: number | bigint;
    lastInsertRowid: number | bigint;
  }

  export interface StatementSync {
    all(...params: unknown[]): unknown[];
    get(...params: unknown[]): unknown;
    run(...params: unknown[]): StatementResult;
  }

  export class DatabaseSync {
    constructor(location: string, options?: Record<string, unknown>);
    exec(sql: string): void;
    prepare(sql: string): StatementSync;
    close(): void;
  }
}
