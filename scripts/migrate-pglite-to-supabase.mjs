import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Pool } from "pg";
import { PGliteDatabase } from "../src/lib/db/pglite.ts";

const ROOT = process.cwd();
const SOURCE_DIR = path.join(ROOT, "data", "merrylane-pglite");
const IDENTIFIER = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
const BATCH_SIZE = 100;

function quoteIdentifier(identifier) {
  assert(IDENTIFIER.test(identifier), `Unexpected PostgreSQL identifier: ${identifier}`);
  return `"${identifier}"`;
}

function qualifiedName(name) {
  return `"public".${quoteIdentifier(name)}`;
}

function fail(message) {
  console.error(`[Migration] ${message}`);
  process.exitCode = 1;
}

async function runSchemaQuery(client, description, sql) {
  try {
    await client.query(sql);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown PostgreSQL error.";
    throw new Error(`${description}: ${message}`, { cause: error });
  }
}

function getConnectionString() {
  const value = process.env.SUPABASE_MIGRATION_URL?.trim();
  if (!value) {
    throw new Error(
      "Set SUPABASE_MIGRATION_URL in the ignored .env.migrate.local file. Do not paste the connection string into chat or source code."
    );
  }

  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(
      "The Supabase connection value is not a valid URL. Copy the full Transaction pooler URI from Supabase; replace any [YOUR-PASSWORD] placeholder with your database password, and URL-encode special characters in the password."
    );
  }
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !url.hostname ||
    !url.username ||
    !url.password ||
    /YOUR-PASSWORD|\[project-ref\]|\[pooler-host\]|\[password\]/i.test(value)
  ) {
    throw new Error(
      "The Supabase connection value is incomplete. Copy the full Transaction pooler URI and replace its password placeholder. Do not share the URI."
    );
  }
  return value;
}

async function getSourceSchema(database) {
  const tables = await database.prepare(`
    SELECT c.relname AS table_name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p')
      AND NOT c.relispartition
    ORDER BY c.relname
  `).all();

  const schema = [];
  for (const { table_name: tableName } of tables) {
    const columns = await database.prepare(`
      SELECT
        a.attname AS column_name,
        format_type(a.atttypid, a.atttypmod) AS data_type,
        a.attnotnull AS not_null,
        pg_get_expr(d.adbin, d.adrelid, true) AS default_expression,
        a.attidentity AS identity_kind,
        a.attgenerated AS generated_kind
      FROM pg_attribute a
      LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
      WHERE a.attrelid = to_regclass('public.' || $1)
        AND a.attnum > 0
        AND NOT a.attisdropped
      ORDER BY a.attnum
    `).all(tableName);
    if (columns.length === 0) {
      throw new Error(`Could not read the columns for table "${tableName}".`);
    }

    const constraints = await database.prepare(`
      SELECT
        conname AS constraint_name,
        contype AS constraint_type,
        pg_get_constraintdef(oid, true) AS definition
      FROM pg_constraint
      WHERE conrelid = to_regclass('public.' || $1)
      ORDER BY contype, conname
    `).all(tableName);

    const indexes = await database.prepare(`
      SELECT i.indexdef
      FROM pg_indexes i
      JOIN pg_class idx ON idx.relname = i.indexname
      JOIN pg_namespace ns ON ns.oid = idx.relnamespace AND ns.nspname = i.schemaname
      WHERE i.schemaname = 'public'
        AND i.tablename = $1
        AND NOT EXISTS (
          SELECT 1 FROM pg_constraint c WHERE c.conindid = idx.oid
        )
      ORDER BY i.indexname
    `).all(tableName);

    const rows = await database.prepare(
      `SELECT * FROM ${qualifiedName(tableName)}`
    ).all();

    schema.push({
      name: tableName,
      columns,
      constraints,
      indexes,
      rows,
    });
  }

  const sequences = await database.prepare(`
    SELECT
      s.relname AS sequence_name,
      format_type(q.seqtypid, NULL) AS data_type,
      q.seqstart AS start_value,
      q.seqincrement AS increment_by,
      q.seqmin AS min_value,
      q.seqmax AS max_value,
      q.seqcache AS cache_value,
      q.seqcycle AS cycle,
      d.deptype AS dependency_type,
      t.relname AS table_name,
      a.attname AS column_name
    FROM pg_class s
    JOIN pg_namespace n ON n.oid = s.relnamespace
    JOIN pg_sequence q ON q.seqrelid = s.oid
    LEFT JOIN pg_depend d
      ON d.objid = s.oid
      AND d.classid = 'pg_class'::regclass
      AND d.refclassid = 'pg_class'::regclass
      AND d.deptype IN ('a', 'i')
    LEFT JOIN pg_class t ON t.oid = d.refobjid
    LEFT JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = d.refobjsubid
    WHERE n.nspname = 'public'
    ORDER BY s.relname
  `).all();

  for (const sequence of sequences) {
    const state = await database.prepare(
      `SELECT last_value, is_called FROM ${qualifiedName(sequence.sequence_name)}`
    ).get();
    sequence.last_value = state?.last_value ?? sequence.start_value;
    sequence.is_called = state?.is_called ?? false;
  }

  return { tables: schema, sequences };
}

function columnDefinition(column) {
  const name = quoteIdentifier(column.column_name);
  const type = column.data_type;
  if (typeof type !== "string" || /[;\0]/.test(type)) {
    throw new Error(`Unsupported type for "${column.column_name}".`);
  }

  let definition = `${name} ${type}`;
  if (column.identity_kind) {
    const kind = column.identity_kind === "a" ? "ALWAYS" : "BY DEFAULT";
    definition += ` GENERATED ${kind} AS IDENTITY`;
  } else if (column.generated_kind) {
    throw new Error(
      `Generated column "${column.column_name}" needs a manual migration review before copying data.`
    );
  } else if (column.default_expression) {
    definition += ` DEFAULT ${column.default_expression}`;
  }
  if (column.not_null) definition += " NOT NULL";
  return definition;
}

async function createSequences(client, sequences) {
  for (const sequence of sequences) {
    if (sequence.dependency_type === "i") continue;
    const name = qualifiedName(sequence.sequence_name);
    await client.query(
      `CREATE SEQUENCE ${name}
       AS ${sequence.data_type}
       INCREMENT BY ${sequence.increment_by}
       MINVALUE ${sequence.min_value}
       MAXVALUE ${sequence.max_value}
       START WITH ${sequence.start_value}
       CACHE ${sequence.cache_value}
       ${sequence.cycle ? "CYCLE" : "NO CYCLE"}`
    );
  }
}

async function createTables(client, tables) {
  for (const table of tables) {
    const columns = table.columns.map(columnDefinition).join(",\n  ");
    await client.query(
      `CREATE TABLE ${qualifiedName(table.name)} (\n  ${columns}\n)`
    );
  }
}

async function copyRows(client, tables) {
  let totalRows = 0;
  for (const table of tables) {
    const columns = table.columns.filter((column) => !column.generated_kind);
    if (columns.length === 0 && table.rows.length > 0) {
      throw new Error(`Table "${table.name}" has rows but no writable columns.`);
    }
    if (columns.length === 0) continue;

    const names = columns.map((column) => quoteIdentifier(column.column_name));
    const targetColumns = names.join(", ");
    for (let offset = 0; offset < table.rows.length; offset += BATCH_SIZE) {
      const batch = table.rows.slice(offset, offset + BATCH_SIZE);
      const parameters = [];
      const values = batch.map((row) => {
        const rowValues = columns.map((column) => row[column.column_name]);
        const placeholders = rowValues.map((value) => {
          parameters.push(value);
          return `$${parameters.length}`;
        });
        return `(${placeholders.join(", ")})`;
      });

      await client.query(
        `INSERT INTO ${qualifiedName(table.name)} (${targetColumns})
         OVERRIDING SYSTEM VALUE
         VALUES ${values.join(", ")}`,
        parameters
      );
    }
    totalRows += table.rows.length;
    console.log(`[Migration] Copied ${table.rows.length} rows from ${table.name}.`);
  }
  return totalRows;
}

async function createConstraintsAndIndexes(client, tables) {
  for (const table of tables) {
    for (const constraint of table.constraints.filter(
      (item) => item.constraint_type === "p" || item.constraint_type === "u"
    )) {
      const name = quoteIdentifier(constraint.constraint_name);
      await runSchemaQuery(
        client,
        `Could not create ${constraint.constraint_type === "p" ? "primary key" : "unique constraint"} ${table.name}.${constraint.constraint_name}`,
        `ALTER TABLE ${qualifiedName(table.name)} ADD CONSTRAINT ${name} ${constraint.definition}`
      );
    }
  }
  for (const table of tables) {
    for (const index of table.indexes.filter((item) => /\bCREATE UNIQUE INDEX\b/i.test(item.indexdef))) {
      await runSchemaQuery(client, `Could not create a unique index on ${table.name}`, index.indexdef);
    }
  }
  for (const table of tables) {
    for (const constraint of table.constraints.filter(
      (item) =>
        item.constraint_type !== "p" &&
        item.constraint_type !== "u" &&
        item.constraint_type !== "n"
    )) {
      const name = quoteIdentifier(constraint.constraint_name);
      await runSchemaQuery(
        client,
        `Could not create constraint ${table.name}.${constraint.constraint_name}`,
        `ALTER TABLE ${qualifiedName(table.name)} ADD CONSTRAINT ${name} ${constraint.definition}`
      );
    }
  }
  for (const table of tables) {
    for (const index of table.indexes.filter((item) => !/\bCREATE UNIQUE INDEX\b/i.test(item.indexdef))) {
      await runSchemaQuery(client, `Could not create an index on ${table.name}`, index.indexdef);
    }
  }
}

async function restoreSequenceStates(client, sequences) {
  for (const sequence of sequences) {
    const sequenceValue = Number(sequence.last_value);
    if (!Number.isSafeInteger(sequenceValue)) {
      throw new Error(`Sequence "${sequence.sequence_name}" has an invalid value.`);
    }

    let value = sequenceValue;
    let called = Boolean(sequence.is_called);
    if (sequence.table_name && sequence.column_name) {
      const max = await client.query(
        `SELECT MAX(${quoteIdentifier(sequence.column_name)}) AS max_value
         FROM ${qualifiedName(sequence.table_name)}`
      );
      const maximum = max.rows[0]?.max_value;
      if (maximum !== null && maximum !== undefined) {
        value = Math.max(value, Number(maximum));
        called = true;
      }
    }

    if (sequence.dependency_type === "i") {
      await client.query(
        `SELECT setval(
           pg_get_serial_sequence($1, $2)::regclass,
           $3::bigint,
           $4::boolean
         )`,
        [`public.${sequence.table_name}`, sequence.column_name, value, called]
      );
      continue;
    }

    await client.query(
      "SELECT setval($1::regclass, $2::bigint, $3::boolean)",
      [`public.${sequence.sequence_name}`, value, called]
    );
    if (sequence.table_name && sequence.column_name) {
      await client.query(
        `ALTER SEQUENCE ${qualifiedName(sequence.sequence_name)}
         OWNED BY ${qualifiedName(sequence.table_name)}.${quoteIdentifier(sequence.column_name)}`
      );
    }
  }
}

async function verifyCounts(client, tables) {
  for (const table of tables) {
    const result = await client.query(
      `SELECT COUNT(*)::bigint AS count FROM ${qualifiedName(table.name)}`
    );
    const actual = Number(result.rows[0]?.count);
    if (actual !== table.rows.length) {
      throw new Error(
        `Row count mismatch for "${table.name}": local ${table.rows.length}, Supabase ${actual}.`
      );
    }
  }
}

async function migrate(connectionString, { dryRun }) {
  const source = PGliteDatabase.open(SOURCE_DIR);
  let target;
  try {
    const { tables, sequences } = await getSourceSchema(source);
    if (tables.length === 0) {
      throw new Error("No public application tables were found in the local database.");
    }

    console.log(`[Migration] Found ${tables.length} tables and ${sequences.length} sequences locally.`);
    console.log(`[Migration] Total local rows: ${tables.reduce((sum, table) => sum + table.rows.length, 0)}.`);
    if (dryRun) {
      console.log("[Migration] Dry run only; Supabase was not contacted or changed.");
      return;
    }

    target = new Pool({
      connectionString,
      max: 1,
      connectionTimeoutMillis: 15_000,
      idleTimeoutMillis: 5_000,
      application_name: "merrylane-data-migration",
    });
    const client = await target.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL TIME ZONE 'Asia/Manila'");
      await client.query("SELECT 1");

      const existing = await client.query(`
        SELECT tablename
        FROM pg_tables
        WHERE schemaname = 'public'
      `);
      const existingNames = new Set(existing.rows.map((row) => row.tablename));
      const conflicts = tables
        .map((table) => table.name)
        .filter((name) => existingNames.has(name));
      if (conflicts.length > 0) {
        throw new Error(
          `Supabase already has public tables with these names: ${conflicts.join(", ")}. Nothing was changed.`
        );
      }

      console.log("[Migration] Creating sequences and tables.");
      await createSequences(client, sequences);
      await createTables(client, tables);
      const totalRows = await copyRows(client, tables);
      console.log("[Migration] Creating keys, constraints, and indexes.");
      await createConstraintsAndIndexes(client, tables);
      console.log("[Migration] Restoring sequence counters and verifying records.");
      await restoreSequenceStates(client, sequences);
      await verifyCounts(client, tables);
      await client.query("COMMIT");
      console.log(
        `[Migration] Complete: copied ${totalRows} rows across ${tables.length} tables and verified counts.`
      );
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        throw new AggregateError(
          [error, rollbackError],
          "Migration failed and the destination transaction could not be rolled back."
        );
      }
      throw error;
    } finally {
      client.release();
    }
  } finally {
    if (target) await target.end();
    await source.close();
  }
}

const dryRun = process.argv.includes("--dry-run");
try {
  const connectionString = dryRun ? undefined : getConnectionString();
  await migrate(connectionString, { dryRun });
} catch (error) {
  fail(error instanceof Error ? error.message : "Unknown migration error.");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href && process.exitCode) {
  process.exit(process.exitCode);
}
