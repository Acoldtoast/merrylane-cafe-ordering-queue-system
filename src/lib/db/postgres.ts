import { AsyncLocalStorage } from "node:async_hooks";
import { Pool, type PoolClient, type QueryResult } from "pg";
import { convertSql } from "./pglite";
import type { Database, DatabaseStatement, RunResult } from "./types";

const transactionStorage = new AsyncLocalStorage<PoolClient>();

class PostgresStatement implements DatabaseStatement {
  private readonly database: PostgresDatabase;
  private readonly sql: string;

  constructor(
    database: PostgresDatabase,
    sql: string
  ) {
    this.database = database;
    this.sql = sql;
  }

  all<T extends Record<string, unknown> = Record<string, unknown>>(
    ...parameters: unknown[]
  ): Promise<T[]> {
    return this.database.all<T>(this.sql, parameters);
  }

  get<T extends Record<string, unknown> = Record<string, unknown>>(
    ...parameters: unknown[]
  ): Promise<T | undefined> {
    return this.database.get<T>(this.sql, parameters);
  }

  run(...parameters: unknown[]): Promise<RunResult> {
    return this.database.run(this.sql, parameters);
  }
}

export class PostgresDatabase implements Database {
  private readonly identityColumns: Map<string, Promise<boolean>>;
  private readonly pool: Pool;
  private readonly transactionClient?: PoolClient;

  constructor(
    pool: Pool,
    transactionClient?: PoolClient,
    identityColumns = new Map<string, Promise<boolean>>()
  ) {
    this.pool = pool;
    this.transactionClient = transactionClient;
    this.identityColumns = identityColumns;
  }

  static open(connectionString: string): PostgresDatabase {
    const pool = new Pool({
      connectionString,
      max: 10,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 30_000,
      statement_timeout: 30_000,
      keepAlive: true,
      options: "-c timezone=Asia/Manila",
      application_name: "merrylane-cafe",
    });
    pool.on("error", (error) => {
      console.error("[Database] Idle PostgreSQL connection error:", error);
    });
    return new PostgresDatabase(pool);
  }

  prepare(sql: string): DatabaseStatement {
    return new PostgresStatement(this, sql);
  }

  async all<T extends Record<string, unknown>>(
    sql: string,
    parameters: unknown[]
  ): Promise<T[]> {
    const pragmaTable = /^\s*PRAGMA\s+table_info\s*\(\s*["'`]?([\w]+)["'`]?\s*\)\s*;?\s*$/i.exec(
      sql
    );
    if (pragmaTable) {
      const result = await this.query<T>(
        `SELECT column_name AS name, data_type
         FROM information_schema.columns
         WHERE table_schema = current_schema() AND table_name = $1
         ORDER BY ordinal_position`,
        [pragmaTable[1]]
      );
      return result.rows;
    }
    return (await this.query<T>(sql, parameters)).rows;
  }

  async get<T extends Record<string, unknown>>(
    sql: string,
    parameters: unknown[]
  ): Promise<T | undefined> {
    return (await this.all<T>(sql, parameters))[0];
  }

  async run(sql: string, parameters: unknown[]): Promise<RunResult> {
    let converted = convertSql(sql);
    const insertTable = /^\s*INSERT\s+INTO\s+([\w"]+)/i.exec(converted);
    if (
      insertTable &&
      !/\bRETURNING\b/i.test(converted) &&
      (await this.hasIdentityColumn(insertTable[1].replaceAll('"', "")))
    ) {
      converted = converted.trimEnd().replace(/;$/, "") + " RETURNING id";
    }

    const result = await this.query(converted, parameters);
    return {
      changes: result.rowCount ?? result.rows.length,
      ...(insertTable && result.rows[0]?.id !== undefined
        ? { lastInsertRowid: Number(result.rows[0].id) }
        : {}),
    };
  }

  async exec(sql: string): Promise<void> {
    const converted = convertSql(sql);
    const client = transactionStorage.getStore() ?? this.transactionClient;
    if (client) {
      await client.query(converted);
      return;
    }
    await this.pool.query(converted);
  }

  async transaction<T>(callback: (database: Database) => Promise<T>): Promise<T> {
    const active = transactionStorage.getStore();
    if (active) {
      return callback(new PostgresDatabase(this.pool, active, this.identityColumns));
    }

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await transactionStorage.run(client, () =>
        callback(new PostgresDatabase(this.pool, client, this.identityColumns))
      );
      await client.query("COMMIT");
      return result;
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        throw new AggregateError(
          [error, rollbackError],
          "The PostgreSQL transaction failed and could not be rolled back."
        );
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    if (!this.transactionClient) {
      await this.pool.end();
    }
  }

  private async query<T extends Record<string, unknown>>(
    sql: string,
    parameters: unknown[]
  ): Promise<QueryResult<T>> {
    const converted = convertSql(sql);
    const client = transactionStorage.getStore() ?? this.transactionClient;
    if (client) {
      return client.query<T>(converted, parameters);
    }
    return this.pool.query<T>(converted, parameters);
  }

  private async hasIdentityColumn(tableName: string): Promise<boolean> {
    let result = this.identityColumns.get(tableName);
    if (!result) {
      result = this.query<{ has_id: boolean }>(
        `SELECT EXISTS (
           SELECT 1 FROM information_schema.columns
           WHERE table_schema = current_schema()
             AND table_name = $1
             AND column_name = 'id'
         ) AS has_id`,
        [tableName]
      )
        .then((query) => query.rows[0]?.has_id === true)
        .catch((error: unknown) => {
          this.identityColumns.delete(tableName);
          throw error;
        });
      this.identityColumns.set(tableName, result);
    }
    return result;
  }
}
