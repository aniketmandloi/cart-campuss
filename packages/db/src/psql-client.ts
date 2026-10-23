import { execFileSync } from "node:child_process";

import type { NeonQueryFunction } from "@neondatabase/serverless";

type PsqlOptions = {
  databaseUrl: string;
  psql: string;
  /** Isolated catalogue schema. Never `public`. Set on every connection. */
  schema?: string;
};

/**
 * Speaks just enough of the Neon query function for Drizzle's neon-http session
 * by shelling out to psql. Selects come back as JSON arrays so the array-mode
 * mapper can read them. There is no transaction support, matching neon-http.
 */
export function createPsqlNeonClient(options: PsqlOptions): NeonQueryFunction<false, false> {
  const query = async (
    statement: string,
    params: unknown[] = [],
    _queryOptions?: { arrayMode?: boolean; fullResults?: boolean },
  ) => {
    const bound = bindParameters(statement, params);
    const executable = bound.trim().replace(/;+\s*$/, "");
    const rowQuery = isRowQuery(executable);
    const sql = rowQuery ? wrapRows(executable) : executable;
    const stdout = executePsql(options, sql);
    if (!rowQuery) return { rows: [], rowCount: 0, fields: [], command: "OK" };
    const parsed: unknown = JSON.parse(stdout.trim() || "[]");
    if (!Array.isArray(parsed)) throw new Error("psql did not return a JSON row list");
    return { rows: parsed, rowCount: parsed.length, fields: [], command: "SELECT" };
  };

  const call = () => {
    throw new Error("The psql catalogue client only accepts parameterized query() calls.");
  };

  return Object.assign(call, {
    query,
    unsafe() {
      throw new Error("The psql catalogue client does not accept unsafe SQL fragments.");
    },
    transaction() {
      throw new Error("No transactions support in neon-http driver");
    },
  }) as unknown as NeonQueryFunction<false, false>;
}

export function runPsql(options: PsqlOptions & { sql: string }): string {
  return executePsql(options, options.sql);
}

export function explainQuery(options: PsqlOptions & { sql: string; params?: unknown[] }): string {
  const bound = bindParameters(options.sql, options.params ?? [])
    .trim()
    .replace(/;+\s*$/, "");
  return executePsql(options, `set enable_seqscan = off;\nexplain (format text)\n${bound};`);
}

function executePsql(options: PsqlOptions, sql: string): string {
  assertDoesNotDropPublic(sql);
  const script = options.schema
    ? `set search_path to ${quoteRunSchema(options.schema)};\n${sql}`
    : sql;
  try {
    return execFileSync(
      options.psql,
      ["--dbname", options.databaseUrl, "-v", "ON_ERROR_STOP=1", "-X", "-q", "-t", "-A", "-f", "-"],
      {
        encoding: "utf8",
        input: script,
        maxBuffer: 32 * 1024 * 1024,
        env: { ...process.env, PGCONNECT_TIMEOUT: "5" },
      },
    );
  } catch (error) {
    const stderr =
      error && typeof error === "object" && "stderr" in error
        ? String((error as { stderr?: unknown }).stderr ?? "")
        : "";
    const message = redact(stderr || (error instanceof Error ? error.message : "psql failed"));
    throw new Error(message.slice(0, 500) || "psql failed");
  }
}

function bindParameters(sql: string, params: unknown[]): string {
  return sql.replace(/\$(\d+)/g, (match, index: string) => {
    const position = Number(index);
    if (!Number.isInteger(position) || position < 1 || position > params.length) return match;
    return literal(params[position - 1]);
  });
}

function literal(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Refusing a non-finite SQL parameter");
    return String(value);
  }
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "string") return `'${value.replaceAll("'", "''")}'`;
  throw new Error("Refusing an unsupported SQL parameter");
}

function isRowQuery(sql: string): boolean {
  return /^(select|with|show|values)\b/i.test(sql);
}

function wrapRows(statement: string): string {
  return `select coalesce(json_agg(s.cells order by s.ord), '[]'::json)::text
from (
  select __psql_row.__psql_ord as ord, (
    select json_agg(j.value order by j.ordinality)
    from json_each(row_to_json(__psql_row)) with ordinality as j(key, value, ordinality)
    where j.key <> '__psql_ord'
  ) as cells
  from (
    select row_number() over () as __psql_ord, __psql_src.*
    from (${statement}) as __psql_src
  ) as __psql_row
) as s`;
}

export function quoteRunSchema(schema: string): string {
  if (!/^catalogue_run_[0-9a-f]{16}$/.test(schema)) {
    throw new Error("Refusing a search_path outside an isolated catalogue schema.");
  }
  return `"${schema}"`;
}

function assertDoesNotDropPublic(sql: string): void {
  if (/\bdrop\s+schema\b[^;]*\bpublic\b/i.test(sql)) {
    throw new Error("Refusing to drop the public schema.");
  }
}

function redact(value: string): string {
  return value
    .replaceAll("provider-secret-do-not-project", "[redacted]")
    .replaceAll("probe-secret-do-not-project", "[redacted]")
    .replace(/postgres(?:ql)?:\/\/\S+/gi, "[redacted-url]");
}
