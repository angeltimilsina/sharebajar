import { readdirSync, readFileSync, mkdirSync } from "node:fs";
import path from "node:path";

/** Minimal query interface shared by Postgres (production) and PGlite (local development without a database). */
export interface Db {
  kind: "postgres" | "pglite";
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  exec(sql: string): Promise<void>;
  notify(channel: string, payload: string): Promise<void>;
  close(): Promise<void>;
}

/**
 * DATABASE_URL → PostgreSQL / TimescaleDB. TLS verifies the server against
 * system CAs (or DATABASE_CA_CERT); it is never disabled.
 * Without DATABASE_URL → embedded PGlite under .data/indexer-db (dev only).
 */
export async function openDb(env = process.env): Promise<Db> {
  if (env.DATABASE_URL) {
    const { Pool } = await import("pg");
    const u = new URL(env.DATABASE_URL);
    const mode = u.searchParams.get("sslmode");
    for (const k of ["sslmode", "sslrootcert", "uselibpqcompat"]) u.searchParams.delete(k);
    const ca = env.DATABASE_CA_CERT?.replace(/\\n/g, "\n");
    const ssl = ca ? { ca } : mode && mode !== "disable" && mode !== "allow" ? true : undefined;
    const pool = new Pool({ connectionString: u.toString(), max: 4, connectionTimeoutMillis: 10_000, ssl });
    return {
      kind: "postgres",
      query: async (sql, params) => (await pool.query(sql, params as unknown[])).rows,
      exec: async (sql) => { await pool.query(sql); },
      notify: async (ch, payload) => { await pool.query("select pg_notify($1, $2)", [ch, payload]); },
      close: () => pool.end(),
    };
  }
  if (env.NODE_ENV === "production") throw new Error("DATABASE_URL is required in production.");
  const { PGlite } = await import("@electric-sql/pglite");
  const dir = env.INDEXER_PGLITE_DIR || path.join(process.cwd(), ".data", "indexer-db");
  if (dir !== "memory://") mkdirSync(dir, { recursive: true });
  const pg = new PGlite(dir);
  return {
    kind: "pglite",
    query: async (sql, params) => (await pg.query(sql, params as unknown[])).rows as never,
    exec: async (sql) => { await pg.exec(sql); },
    notify: async () => { /* no listeners in embedded mode */ },
    close: () => pg.close(),
  };
}

/** Applies migrations/*.sql in order, once each, recorded in schema_migrations. */
export async function migrate(db: Db, dir = path.join(path.dirname(new URL(import.meta.url).pathname), "..", "migrations")): Promise<string[]> {
  await db.exec("create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())");
  const done = new Set((await db.query<{ name: string }>("select name from schema_migrations")).map((r) => r.name));
  const applied: string[] = [];
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".sql")).sort()) {
    if (done.has(f)) continue;
    await db.exec(readFileSync(path.join(dir, f), "utf8"));
    await db.query("insert into schema_migrations (name) values ($1)", [f]);
    applied.push(f);
  }
  return applied;
}
