import { PGlite, type Results, type Transaction } from "@electric-sql/pglite";
import { AsyncLocalStorage } from "node:async_hooks";
import fs from "node:fs";
import path from "node:path";

export interface RunResult {
  changes: number;
  lastInsertRowid?: number;
}

type Executor = PGlite | Transaction;

/**
 * PGlite runs on a single connection. While a transaction is open, every
 * query issued by the transaction's async call chain must run on the
 * transaction client, and queries from other requests must wait. AsyncLocalStorage
 * lets model helpers keep calling `getDb()` while the adapter transparently
 * routes those calls to the active transaction.
 */
const transactionStorage = new AsyncLocalStorage<Transaction>();

function convertPlaceholders(sql: string): string {
  let output = "";
  let parameterIndex = 0;
  let quote: "'" | '"' | "`" | null = null;
  let lineComment = false;
  let blockComment = false;

  for (let index = 0; index < sql.length; index += 1) {
    const character = sql[index];
    const next = sql[index + 1];

    if (lineComment) {
      output += character;
      if (character === "\n") lineComment = false;
      continue;
    }
    if (blockComment) {
      output += character;
      if (character === "*" && next === "/") {
        output += next;
        index += 1;
        blockComment = false;
      }
      continue;
    }
    if (quote) {
      if (quote === "`" && character === "`") {
        output += '"';
        quote = null;
      } else {
        output += character;
        if (character === quote) {
          if (next === quote) {
            output += next;
            index += 1;
          } else {
            quote = null;
          }
        }
      }
      continue;
    }

    if (character === "-" && next === "-") {
      output += "--";
      index += 1;
      lineComment = true;
    } else if (character === "/" && next === "*") {
      output += "/*";
      index += 1;
      blockComment = true;
    } else if (character === "'" || character === '"') {
      quote = character;
      output += character;
    } else if (character === "`") {
      quote = "`";
      output += '"';
    } else if (character === "?") {
      parameterIndex += 1;
      output += `$${parameterIndex}`;
    } else {
      output += character;
    }
  }

  return output;
}

interface FunctionCall {
  start: number;
  open: number;
  close: number;
  args: string[];
}

function findClosingParen(sql: string, open: number): number {
  let depth = 0;
  let quote: "'" | '"' | null = null;
  for (let index = open; index < sql.length; index += 1) {
    const character = sql[index];
    if (quote) {
      if (character === quote && sql[index + 1] === quote) index += 1;
      else if (character === quote) quote = null;
    } else if (character === "'" || character === '"') {
      quote = character;
    } else if (character === "(") {
      depth += 1;
    } else if (character === ")" && --depth === 0) {
      return index;
    }
  }
  return -1;
}

/**
 * Find `name(...)` calls outside string literals. Nested calls are returned
 * too so the caller can rewrite the innermost one first.
 */
function findFunctionCalls(sql: string, name: string): FunctionCall[] {
  const calls: FunctionCall[] = [];
  const lowerName = name.toLowerCase();
  let quote: "'" | '"' | null = null;
  for (let index = 0; index < sql.length; index += 1) {
    const character = sql[index];
    if (quote) {
      if (character === quote && sql[index + 1] === quote) index += 1;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }
    if (sql.slice(index, index + lowerName.length).toLowerCase() !== lowerName) {
      continue;
    }
    if (index > 0 && /[\w$]/.test(sql[index - 1])) continue;
    let cursor = index + lowerName.length;
    while (cursor < sql.length && /\s/.test(sql[cursor])) cursor += 1;
    if (sql[cursor] !== "(") continue;
    const close = findClosingParen(sql, cursor);
    if (close < 0) continue;
    calls.push({
      start: index,
      open: cursor,
      close,
      args: splitArguments(sql.slice(cursor + 1, close)),
    });
  }
  return calls;
}

function rewriteFunctionCalls(
  sql: string,
  name: string,
  transform: (args: string[]) => string
): string {
  let current = sql;
  for (let iteration = 0; ; iteration += 1) {
    if (iteration > 50) {
      throw new Error(`convertSql rewrite loop for ${name}: ${current}`);
    }
    const calls = findFunctionCalls(current, name);
    if (calls.length === 0) return current;
    // Rewrite the innermost call so nested arguments are handled first.
    const call = calls.reduce((innermost, candidate) =>
      candidate.open > innermost.open ? candidate : innermost
    );
    current =
      current.slice(0, call.start) +
      transform(call.args) +
      current.slice(call.close + 1);
  }
}

function normalizeArgument(value: string | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function transformDatetime(args: string[]): string {
  if (normalizeArgument(args[0]) !== "'now'") {
    throw new Error(`Unsupported datetime() call: datetime(${args.join(", ")})`);
  }
  const localtime = args.some((arg) => normalizeArgument(arg) === "'localtime'");
  const modifiers = args.filter((arg) => normalizeArgument(arg) !== "'localtime'").slice(1);
  const base = localtime
    ? "timezone('Asia/Manila', CURRENT_TIMESTAMP)"
    : "CURRENT_TIMESTAMP";
  if (modifiers.length === 0) {
    return `to_char(${base}, 'YYYY-MM-DD HH24:MI:SS')`;
  }
  if (modifiers.length === 1) {
    return `to_char(${base} + (${modifiers[0]})::interval, 'YYYY-MM-DD HH24:MI:SS')`;
  }
  throw new Error(`Unsupported datetime() call: datetime(${args.join(", ")})`);
}

function transformDate(args: string[]): string {
  if (normalizeArgument(args[0]) === "'now'") {
    const modifiers = args
      .filter((arg) => normalizeArgument(arg) !== "'localtime'")
      .slice(1);
    if (modifiers.length === 0) return "to_char(CURRENT_DATE, 'YYYY-MM-DD')";
    if (modifiers.length === 1) {
      return `to_char((CURRENT_DATE + (${modifiers[0]})::interval)::date, 'YYYY-MM-DD')`;
    }
    throw new Error(`Unsupported date() call: date(${args.join(", ")})`);
  }
  if (args.length === 1) {
    return `to_char((${args[0]})::date, 'YYYY-MM-DD')`;
  }
  if (args.length === 2) {
    return `to_char(((${args[0]})::date + (${args[1]})::interval)::date, 'YYYY-MM-DD')`;
  }
  throw new Error(`Unsupported date() call: date(${args.join(", ")})`);
}

function transformStrftime(args: string[]): string {
  const format = normalizeArgument(args[0]);
  if (args.length !== 2) {
    throw new Error(`Unsupported strftime() call: strftime(${args.join(", ")})`);
  }
  if (format === "'%h'") {
    return `to_char((${args[1]})::timestamp, 'HH24')`;
  }
  if (format === "'%w'") {
    return `EXTRACT(DOW FROM (${args[1]})::timestamp)`;
  }
  if (format === "'%y-%m-%d %h:00'") {
    return `to_char((${args[1]})::timestamp, 'YYYY-MM-DD HH24:00')`;
  }
  throw new Error(`Unsupported strftime() call: strftime(${args.join(", ")})`);
}

function transformJulianday(args: string[]): string {
  if (args.length === 2 && normalizeArgument(args[0]) === "'now'") {
    if (normalizeArgument(args[1]) === "'localtime'") {
      return "(EXTRACT(EPOCH FROM timezone('Asia/Manila', CURRENT_TIMESTAMP)) / 86400.0)";
    }
  }
  if (args.length === 1) {
    if (normalizeArgument(args[0]) === "'now'") {
      return "(EXTRACT(EPOCH FROM CURRENT_TIMESTAMP) / 86400.0)";
    }
    return `(EXTRACT(EPOCH FROM (${args[0]})::timestamp) / 86400.0)`;
  }
  throw new Error(`Unsupported julianday() call: julianday(${args.join(", ")})`);
}

function convertSql(sql: string): string {
  if (/^\s*INSERT\s+OR\s+REPLACE\b/i.test(sql)) {
    throw new Error("INSERT OR REPLACE must be rewritten as a PostgreSQL upsert.");
  }

  const ignoreConflicts = /^\s*INSERT\s+OR\s+IGNORE\b/i.test(sql);
  let converted = convertPlaceholders(sql).replace(
    /^\s*INSERT\s+OR\s+IGNORE\s+INTO\b/i,
    "INSERT INTO"
  );
  converted = converted.replace(/\bIFNULL\s*\(/gi, "COALESCE(");
  converted = rewriteFunctionCalls(converted, "datetime", transformDatetime);
  converted = rewriteFunctionCalls(converted, "date", transformDate);
  converted = rewriteFunctionCalls(converted, "strftime", transformStrftime);
  converted = rewriteFunctionCalls(converted, "julianday", transformJulianday);
  converted = rewriteMultiArgumentFunction(converted, "MAX", "GREATEST");
  converted = rewriteMultiArgumentFunction(converted, "MIN", "LEAST");
  if (
    ignoreConflicts &&
    /^\s*INSERT\s+INTO\b/i.test(converted) &&
    !/\bON\s+CONFLICT\b/i.test(converted)
  ) {
    const semicolon = converted.trimEnd().endsWith(";");
    converted = converted.trimEnd().replace(/;$/, "");
    converted += " ON CONFLICT DO NOTHING";
    if (semicolon) converted += ";";
  }
  return converted;
}

function splitArguments(value: string): string[] {
  const args: string[] = [];
  let start = 0;
  let depth = 0;
  let quote: "'" | '"' | null = null;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (quote) {
      if (character === quote && value[index + 1] === quote) index += 1;
      else if (character === quote) quote = null;
    } else if (character === "'" || character === '"') {
      quote = character;
    } else if (character === "(") {
      depth += 1;
    } else if (character === ")") {
      depth -= 1;
    } else if (character === "," && depth === 0) {
      args.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }
  args.push(value.slice(start).trim());
  return args;
}

function rewriteMultiArgumentFunction(
  sql: string,
  functionName: "MAX" | "MIN",
  replacement: "GREATEST" | "LEAST"
): string {
  let current = sql;
  for (let iteration = 0; ; iteration += 1) {
    if (iteration > 50) {
      throw new Error(
        `convertSql ${functionName} rewrite loop: ${current}`
      );
    }
    const calls = findFunctionCalls(current, functionName).filter(
      (call) => call.args.length >= 2
    );
    if (calls.length === 0) return current;
    const call = calls.reduce((innermost, candidate) =>
      candidate.open > innermost.open ? candidate : innermost
    );
    current =
      current.slice(0, call.start) +
      `${replacement}(${call.args.join(", ")})` +
      current.slice(call.close + 1);
  }
}

class PGliteStatement {
  private readonly database: PGliteDatabase;
  private readonly sql: string;

  constructor(database: PGliteDatabase, sql: string) {
    this.database = database;
    this.sql = sql;
  }

  async all<T extends Record<string, unknown> = Record<string, unknown>>(
    ...parameters: unknown[]
  ): Promise<T[]> {
    return this.database.all<T>(this.sql, parameters);
  }

  async get<T extends Record<string, unknown> = Record<string, unknown>>(
    ...parameters: unknown[]
  ): Promise<T | undefined> {
    return this.database.get<T>(this.sql, parameters);
  }

  async run(...parameters: unknown[]): Promise<RunResult> {
    return this.database.run(this.sql, parameters);
  }
}

export class PGliteDatabase {
  private client: PGlite;
  private readonly transactionClient?: Transaction;
  private readonly directory: string;
  private ready: Promise<void>;
  private readonly identityColumns = new Map<string, Promise<boolean>>();

  private constructor(
    client: PGlite,
    directory: string,
    transactionClient?: Transaction,
    ready?: Promise<void>
  ) {
    this.client = client;
    this.directory = directory;
    this.transactionClient = transactionClient;
    this.ready = ready ?? this.initializeClient(client);
  }

  static open(directory = path.join(process.cwd(), "data", "merrylane-pglite")) {
    fs.mkdirSync(path.dirname(directory), { recursive: true });
    return new PGliteDatabase(new PGlite(directory), directory);
  }

  prepare(sql: string): PGliteStatement {
    return new PGliteStatement(this, sql);
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
      changes: result.affectedRows ?? result.rowCount ?? result.rows.length,
      ...(insertTable && result.rows[0]?.id !== undefined
        ? { lastInsertRowid: Number(result.rows[0].id) }
        : {}),
    };
  }

  async exec(sql: string): Promise<void> {
    if (/^\s*PRAGMA\s+(?:foreign_keys|journal_mode|busy_timeout)\b/i.test(sql)) {
      return;
    }
    await this.withDatabaseRecovery(async () => {
      await this.ready;
      await this.executor().exec(convertSql(sql));
    });
  }

  async transaction<T>(callback: (database: PGliteDatabase) => Promise<T>): Promise<T> {
    const active = transactionStorage.getStore();
    if (active) {
      // Nested calls join the transaction that is already in progress.
      return callback(new PGliteDatabase(this.client, this.directory, active, this.ready));
    }
    if (this.transactionClient) {
      throw new Error("Nested PGlite transactions are not supported.");
    }
    await this.ready;
    return this.client.transaction((transaction) =>
      transactionStorage.run(transaction, () =>
        callback(new PGliteDatabase(this.client, this.directory, transaction, this.ready))
      )
    );
  }

  async close(): Promise<void> {
    if (!this.transactionClient) {
      await this.ready;
      await this.client.close();
    }
  }

  private async query<T extends Record<string, unknown>>(
    sql: string,
    parameters: unknown[]
  ): Promise<Results<T>> {
    return this.withDatabaseRecovery(async () => {
      await this.ready;
      return this.executor().query<T>(convertSql(sql), parameters);
    });
  }

  private async withDatabaseRecovery<T>(
    operation: () => Promise<T>
  ): Promise<T> {
    // Never replace the active database automatically after an error.
    // Preserve the directory for an operator to diagnose and recover.
    return operation();
  }

  private async initializeClient(client: PGlite): Promise<void> {
    await client.waitReady;
    await client.exec("SET TIME ZONE 'Asia/Manila'");
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
      ).then((query) => query.rows[0]?.has_id === true);
      this.identityColumns.set(tableName, result);
    }
    return result;
  }

  private executor(): Executor {
    return transactionStorage.getStore() ?? this.transactionClient ?? this.client;
  }
}

export { convertSql };
