import { spawn } from "node:child_process";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";

import { createDb, migrateDatabase, setDatabaseFetchEndpoint, type Database } from "@cart-campuss/db";

const PG_BIN = "/Applications/Postgres.app/Contents/Versions/latest/bin";

type Field = {
  name: string;
  tableID: number;
  columnID: number;
  dataTypeID: number;
  dataTypeSize: number;
  dataTypeModifier: number;
  format: number;
};

type QueryResult = {
  fields: Field[];
  rows: Array<Array<string | null>>;
  command: string;
  rowCount: number;
  rowAsArray: true;
};

class PgWireError extends Error {
  readonly code: string | undefined;

  constructor(message: string, code?: string) {
    super(message);
    this.name = "PgWireError";
    this.code = code;
  }
}

/**
 * Speaks just enough of the Postgres wire protocol to run one simple-query
 * transaction. The Neon HTTP bridge below uses it so publication rollback is a
 * real Postgres rollback, not an in-memory fake.
 */
class PgSession {
  private buffer = Buffer.alloc(0);
  private pending: Array<{
    size: number;
    resolve: (chunk: Buffer) => void;
    reject: (error: Error) => void;
  }> = [];
  private closed = false;

  private constructor(private readonly socket: net.Socket) {
    socket.on("data", (chunk: Uint8Array) => {
      const incoming = Buffer.from(chunk);
      this.buffer = this.buffer.length === 0 ? incoming : Buffer.concat([this.buffer, incoming]);
      this.drain();
    });
    socket.on("error", (error) => this.fail(error));
    socket.on("close", () => this.fail(new Error("Postgres connection closed")));
  }

  static connect(port: number, database: string): Promise<PgSession> {
    return new Promise((resolve, reject) => {
      const socket = net.connect({ host: "127.0.0.1", port });
      const session = new PgSession(socket);
      socket.once("error", reject);
      socket.once("connect", () => {
        socket.setTimeout(20_000, () => {
          socket.destroy(new Error("Postgres connection timed out"));
        });
        session.sendStartup(database);
        session.ready().then(
          () => {
            socket.removeListener("error", reject);
            resolve(session);
          },
          (error: unknown) => {
            socket.destroy();
            reject(error instanceof Error ? error : new Error("Postgres startup failed"));
          },
        );
      });
    });
  }

  async query(statement: string): Promise<QueryResult> {
    const body = Buffer.from(`${statement}\0`, "utf8");
    const packet = Buffer.alloc(5 + body.length);
    packet[0] = 0x51;
    packet.writeInt32BE(4 + body.length, 1);
    body.copy(packet, 5);
    this.socket.write(packet);

    let fields: Field[] = [];
    let rows: Array<Array<string | null>> = [];
    let command = "";
    let error: PgWireError | undefined;
    for (;;) {
      const message = await this.readMessage();
      const tag = String.fromCharCode(message.tag);
      if (tag === "T") {
        fields = parseRowDescription(message.payload);
        rows = [];
      } else if (tag === "D") {
        rows.push(parseDataRow(message.payload));
      } else if (tag === "C") {
        command = message.payload.toString("utf8").replace(/\0$/, "");
      } else if (tag === "E") {
        error = parseError(message.payload);
      } else if (tag === "Z") {
        if (error) throw error;
        const count = /(\d+)\s*$/.exec(command);
        return {
          fields,
          rows,
          command,
          rowCount: count ? Number(count[1]) : 0,
          rowAsArray: true,
        };
      }
    }
  }

  async close(): Promise<void> {
    this.closed = true;
    const packet = Buffer.from([0x58, 0, 0, 0, 4]);
    this.socket.end(packet);
    await new Promise<void>((resolve) => {
      if (this.socket.destroyed) {
        resolve();
        return;
      }
      this.socket.once("close", () => resolve());
    });
  }

  private sendStartup(database: string): void {
    const params = Buffer.from(
      `user\0publishing_test\0database\0${database}\0client_encoding\0UTF8\0\0`,
      "utf8",
    );
    const protocol = Buffer.alloc(4);
    protocol.writeInt32BE(196608, 0);
    const body = Buffer.concat([protocol, params]);
    const length = Buffer.alloc(4);
    length.writeInt32BE(4 + body.length, 0);
    this.socket.write(Buffer.concat([length, body]));
  }

  private async ready(): Promise<void> {
    for (;;) {
      const message = await this.readMessage();
      const tag = String.fromCharCode(message.tag);
      if (tag === "R") {
        const authType = message.payload.readInt32BE(0);
        if (authType !== 0) throw new PgWireError(`Postgres requested authentication type ${authType}`);
      } else if (tag === "E") {
        throw parseError(message.payload);
      } else if (tag === "Z") {
        return;
      }
    }
  }

  private readMessage(): Promise<{ tag: number; payload: Buffer }> {
    return this.readBytes(5).then(async (header) => {
      const tag = header[0];
      if (tag === undefined) throw new PgWireError("Postgres frame was empty");
      const length = header.readInt32BE(1);
      if (length < 4) throw new PgWireError("Postgres frame length was invalid");
      const payload = await this.readBytes(length - 4);
      return { tag, payload };
    });
  }

  private readBytes(size: number): Promise<Buffer> {
    if (this.buffer.length >= size) {
      const chunk = Buffer.from(this.buffer.subarray(0, size));
      this.buffer = this.buffer.subarray(size);
      return Promise.resolve(chunk);
    }
    return new Promise((resolve, reject) => {
      this.pending.push({ size, resolve, reject });
    });
  }

  private drain(): void {
    while (this.pending.length > 0) {
      const next = this.pending[0];
      if (!next || this.buffer.length < next.size) return;
      const chunk = Buffer.from(this.buffer.subarray(0, next.size));
      this.buffer = this.buffer.subarray(next.size);
      this.pending.shift();
      next.resolve(chunk);
    }
  }

  private fail(error: Error): void {
    if (this.closed) return;
    this.closed = true;
    const waiters = this.pending.splice(0);
    for (const waiter of waiters) waiter.reject(error);
  }
}

function parseRowDescription(payload: Buffer): Field[] {
  let offset = 0;
  const count = payload.readInt16BE(offset);
  offset += 2;
  const fields: Field[] = [];
  for (let index = 0; index < count; index += 1) {
    const end = payload.indexOf(0, offset);
    const name = payload.toString("utf8", offset, end);
    offset = end + 1;
    const tableID = payload.readInt32BE(offset);
    offset += 4;
    const columnID = payload.readInt16BE(offset);
    offset += 2;
    const dataTypeID = payload.readInt32BE(offset);
    offset += 4;
    const dataTypeSize = payload.readInt16BE(offset);
    offset += 2;
    const dataTypeModifier = payload.readInt32BE(offset);
    offset += 4;
    const format = payload.readInt16BE(offset);
    offset += 2;
    fields.push({ name, tableID, columnID, dataTypeID, dataTypeSize, dataTypeModifier, format });
  }
  return fields;
}

function parseDataRow(payload: Buffer): Array<string | null> {
  let offset = 0;
  const count = payload.readInt16BE(offset);
  offset += 2;
  const values: Array<string | null> = [];
  for (let index = 0; index < count; index += 1) {
    const length = payload.readInt32BE(offset);
    offset += 4;
    if (length < 0) {
      values.push(null);
      continue;
    }
    values.push(payload.toString("utf8", offset, offset + length));
    offset += length;
  }
  return values;
}

function parseError(payload: Buffer): PgWireError {
  let offset = 0;
  let message = "Postgres error";
  let code: string | undefined;
  while (offset < payload.length) {
    const fieldType = String.fromCharCode(payload[offset] ?? 0);
    offset += 1;
    if (fieldType === "\0") break;
    const end = payload.indexOf(0, offset);
    const text = payload.toString("utf8", offset, end);
    offset = end + 1;
    if (fieldType === "M") message = text;
    if (fieldType === "C") code = text;
  }
  return new PgWireError(message, code);
}

type SqlQuery = { query?: string; params?: unknown[] };

async function runTransaction(port: number, database: string, queries: SqlQuery[]): Promise<QueryResult[]> {
  const session = await PgSession.connect(port, database);
  try {
    await session.query("BEGIN");
    const results: QueryResult[] = [];
    try {
      for (const query of queries) {
        if (!query.query) throw new PgWireError("A database request was missing its SQL");
        results.push(await session.query(bindSql(query.query, query.params ?? [])));
      }
      await session.query("COMMIT");
      return results;
    } catch (error) {
      await session.query("ROLLBACK").catch(() => undefined);
      throw error;
    }
  } finally {
    await session.close();
  }
}

function bindSql(query: string, params: unknown[]): string {
  return query.replace(/\$(\d+)/g, (token, indexText: string) => {
    const index = Number(indexText) - 1;
    if (!Number.isInteger(index) || index < 0 || index >= params.length) return token;
    return sqlLiteral(params[index]);
  });
}

function sqlLiteral(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new PgWireError("A database parameter was not finite");
    return String(value);
  }
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (typeof value === "string") return quoteLiteral(value);
  return quoteLiteral(JSON.stringify(value));
}

function quoteLiteral(value: string): string {
  if (value.includes("\0")) throw new PgWireError("A database parameter contained a null byte");
  return `'${value.replaceAll("'", "''")}'`;
}

function startBridge(pgPort: number): Promise<{ url: string; close: () => Promise<void> }> {
  const server = createServer((request, response) => {
    void handleBridge(pgPort, request, response);
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("The local database bridge did not bind a port"));
        return;
      }
      resolve({
        url: `http://127.0.0.1:${address.port}/sql`,
        close: () =>
          new Promise((closeResolve, closeReject) => {
            server.close((error) => (error ? closeReject(error) : closeResolve()));
          }),
      });
    });
  });
}

async function handleBridge(pgPort: number, request: IncomingMessage, response: ServerResponse): Promise<void> {
  if (request.method !== "POST") {
    response.writeHead(405, { "content-type": "application/json" });
    response.end(JSON.stringify({ message: "The database bridge only accepts POST" }));
    return;
  }
  try {
    const raw = await readRequestBody(request);
    const body = JSON.parse(raw) as SqlQuery & { queries?: SqlQuery[] };
    const queries = Array.isArray(body.queries) ? body.queries : [body];
    const database = databaseName(request.headers["neon-connection-string"]);
    const results = await runTransaction(pgPort, database, queries);
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(Array.isArray(body.queries) ? { results } : results[0]));
  } catch (error) {
    const message = error instanceof Error ? error.message : "database error";
    const code = error instanceof PgWireError ? error.code : undefined;
    response.writeHead(400, { "content-type": "application/json" });
    response.end(JSON.stringify({ message, code, severity: "ERROR" }));
  }
}

/**
 * The Neon client sends the connection string so a proxy can choose a database.
 * This bridge reads only that database name. It always connects to the temporary
 * cluster on 127.0.0.1 and never dials the host in the header.
 */
function databaseName(header: string | string[] | undefined): string {
  const value = Array.isArray(header) ? header[0] : header;
  if (!value) return "postgres";
  try {
    const name = decodeURIComponent(new URL(value).pathname.replace(/^\//, ""));
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return name;
  } catch {
    return "postgres";
  }
  return "postgres";
}

function readRequestBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

function commandEnv(dataDir: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: `${PG_BIN}${delimiter}${process.env.PATH ?? ""}`,
    PGDATA: dataDir,
  };
  delete env.DATABASE_URL;
  delete env.PGHOST;
  delete env.PGPORT;
  delete env.PGUSER;
  delete env.OPERATOR_TOKEN;
  return env;
}

async function stopPostgres(dataDir: string, env: NodeJS.ProcessEnv): Promise<void> {
  try {
    await runCommand(join(PG_BIN, "pg_ctl"), ["-D", dataDir, "-m", "fast", "-w", "stop"], env);
  } catch {
    await runCommand(join(PG_BIN, "pg_ctl"), ["-D", dataDir, "-m", "immediate", "-w", "stop"], env).catch(
      () => undefined,
    );
  }
}

function runCommand(command: string, args: string[], env: NodeJS.ProcessEnv): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, stdio: ["ignore", "pipe", "pipe"] });
    const output: Buffer[] = [];
    child.stdout?.on("data", (chunk: Buffer) => output.push(chunk));
    child.stderr?.on("data", (chunk: Buffer) => output.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      const detail = Buffer.concat(output).toString("utf8").slice(-1500);
      reject(new Error(`${command} exited ${code ?? "unknown"}. ${detail}`));
    });
  });
}

async function reservePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      if (!address || typeof address === "string") {
        probe.close();
        reject(new Error("Could not reserve a local port"));
        return;
      }
      const { port } = address;
      probe.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

/**
 * Creates an empty Postgres cluster in a temporary directory and serves it
 * through the Neon HTTP transaction protocol. It does not read DATABASE_URL
 * and does not open an existing database.
 */
export async function startPublishingDatabase(): Promise<{ db: Database; stop: () => Promise<void>; holdAdvisoryLock: (key: number) => Promise<() => Promise<void>> }> {
  const dataDir = await mkdtemp(join(tmpdir(), "cart-campuss-publishing-"));
  const env = commandEnv(dataDir);
  const port = await reservePort();
  let postgresStarted = false;
  let bridge: { url: string; close: () => Promise<void> } | undefined;
  let restoreFetchEndpoint: (() => void) | undefined;
  let stopped = false;

  const stop = async (): Promise<void> => {
    if (stopped) return;
    stopped = true;
    process.off("SIGINT", stopOnSignal);
    process.off("SIGTERM", stopOnSignal);
    restoreFetchEndpoint?.();
    restoreFetchEndpoint = undefined;
    await bridge?.close().catch(() => undefined);
    if (postgresStarted) {
      await stopPostgres(dataDir, env);
    }
    await rm(dataDir, { recursive: true, force: true });
  };

  const stopOnSignal = (): void => {
    void stop();
  };
  process.once("SIGINT", stopOnSignal);
  process.once("SIGTERM", stopOnSignal);

  try {
    await runCommand(
      join(PG_BIN, "initdb"),
      ["-D", dataDir, "-U", "publishing_test", "--auth=trust", "-E", "UTF8", "--locale=C", "--no-instructions"],
      env,
    );
    await runCommand(
      join(PG_BIN, "pg_ctl"),
      [
        "-D",
        dataDir,
        "-l",
        join(dataDir, "server.log"),
        "-w",
        "-o",
        `-p ${port} -h 127.0.0.1 -c fsync=off -c synchronous_commit=off -c full_page_writes=off`,
        "start",
      ],
      env,
    );
    postgresStarted = true;
    bridge = await startBridge(port);
    restoreFetchEndpoint = setDatabaseFetchEndpoint(bridge.url);
    const db = createDb({
      DATABASE_URL: `postgres://publishing_test@127.0.0.1:${port}/postgres`,
    });
    const migrationsFolder = fileURLToPath(new URL("../../../packages/db/src/migrations", import.meta.url));
    await migrateDatabase(db, migrationsFolder);
    return {
      db,
      stop,
      holdAdvisoryLock: async (key) => {
        const session = await PgSession.connect(port, "postgres");
        await session.query("BEGIN");
        await session.query(`select pg_advisory_xact_lock(${sqlLiteral(key)})`);
        return async () => {
          try { await session.query("COMMIT"); }
          finally { await session.close(); }
        };
      },
    };
  } catch (error) {
    await stop();
    throw error;
  }
}
