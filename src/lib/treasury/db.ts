import "server-only";
import path from "node:path";
import { mkdirSync } from "node:fs";

/**
 * Treasury database. Production: PostgreSQL via DATABASE_URL (Neon, Supabase,
 * RDS, Vercel Postgres…). Local development: embedded Postgres (PGlite) under
 * .data/ — same SQL dialect, no setup. Serverless hosts have an ephemeral
 * filesystem, so DATABASE_URL is required in production.
 */
export interface Db {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  kind: "postgres" | "pglite";
}

const SCHEMA = `
create table if not exists admins (
  address text primary key,
  chain_type text not null,
  role text not null check (role in ('viewer','operator','admin','owner')),
  label text,
  added_by text not null,
  created_at timestamptz not null default now()
);
create table if not exists treasuries (
  id text primary key,
  chain text not null,
  chain_type text not null,
  environment text not null default 'mainnet',
  label text not null,
  address text not null,
  kind text not null,
  status text not null default 'registered',
  ownership text,
  inspection text,
  fee_config text,
  integrity text not null,
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (chain, address, kind)
);
create table if not exists change_requests (
  id text primary key,
  treasury_id text,
  action text not null,
  payload text not null,
  payload_hash text not null,
  status text not null default 'pending',
  requested_by text not null,
  requester_signature text not null,
  approvals text not null default '[]',
  reason text,
  created_at timestamptz not null default now(),
  decided_at timestamptz
);
create table if not exists swap_intents (
  id text primary key,
  chain text not null,
  provider text not null,
  mode text not null,
  tx_hash text,
  request_id text,
  taker text not null,
  treasury_id text,
  fee_token text,
  fee_account text,
  fee_bps integer not null default 0,
  expected_fee numeric,
  provider_share_bps integer not null default 0,
  quote_out numeric,
  slippage_bps integer,
  environment text not null default 'mainnet',
  is_test boolean not null default false,
  status text not null default 'submitted',
  status_detail text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (chain, tx_hash)
);
create table if not exists revenue_events (
  id text primary key,
  chain text not null,
  tx_hash text not null,
  log_index integer not null default 0,
  treasury_id text,
  fee_recipient text not null,
  token text not null,
  token_symbol text,
  decimals integer not null,
  amount_raw numeric not null,
  amount numeric not null,
  gross_amount numeric,
  provider_share numeric not null default 0,
  direction text not null,
  source text not null,
  provider text,
  is_revenue boolean not null,
  status text not null,
  confirmations integer not null default 0,
  block_number bigint,
  block_hash text,
  block_time timestamptz,
  usd_price numeric,
  usd_value numeric,
  price_source text,
  intent_id text,
  expected_amount numeric,
  reconciliation text,
  environment text not null default 'mainnet',
  is_test boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (chain, tx_hash, log_index, fee_recipient)
);
create index if not exists revenue_events_time on revenue_events (block_time);
create table if not exists ledger (
  seq bigserial primary key,
  event_id text,
  entry_type text not null,
  account text not null,
  token text not null,
  amount numeric not null,
  usd_value numeric,
  memo text,
  prev_hash text not null,
  hash text not null,
  created_at timestamptz not null default now()
);
create table if not exists expenses (
  id text primary key,
  chain text not null,
  tx_hash text not null,
  treasury_id text,
  native_fee numeric not null,
  native_symbol text not null,
  usd_value numeric,
  kind text not null,
  block_time timestamptz,
  unique (chain, tx_hash)
);
create table if not exists index_cursors (
  treasury_id text not null,
  account text not null,
  cursor text,
  updated_at timestamptz not null default now(),
  primary key (treasury_id, account)
);
create table if not exists audit_log (
  id bigserial primary key,
  at timestamptz not null default now(),
  actor text,
  role text,
  action text not null,
  target text,
  outcome text not null,
  details text,
  ip text
);
create table if not exists alerts (
  id bigserial primary key,
  at timestamptz not null default now(),
  severity text not null,
  kind text not null,
  message text not null,
  details text,
  acknowledged_by text,
  acknowledged_at timestamptz
);
create table if not exists validation_runs (
  id bigserial primary key,
  treasury_id text not null,
  check_key text not null,
  outcome text not null,
  details text,
  at timestamptz not null default now()
);
create table if not exists token_metadata (
  id text primary key,
  json text not null,
  created_at timestamptz not null default now()
);
create table if not exists token_launches (
  mint text primary key,
  chain text not null,
  name text not null,
  symbol text not null,
  creator text not null,
  signature text not null,
  metadata_uri text,
  fixed_supply boolean not null,
  freeze_revoked boolean not null,
  supply text not null,
  decimals int not null,
  created_at timestamptz not null default now()
);
create table if not exists profiles (
  id text primary key,
  created_at timestamptz not null default now()
);
create table if not exists profile_wallets (
  address text primary key,
  profile_id text not null,
  chain_type text not null,
  label text,
  verified_at timestamptz not null default now()
);
create index if not exists profile_wallets_profile on profile_wallets (profile_id);
create table if not exists subscriptions (
  id text primary key,
  profile_id text not null,
  plan text not null,
  period_end timestamptz not null,
  chain text not null,
  signature text not null unique,
  payer text not null,
  amount_raw text not null,
  created_at timestamptz not null default now()
);
create index if not exists subscriptions_profile on subscriptions (profile_id);
`;

const g = globalThis as unknown as { __sbDb?: Promise<Db> };

async function open(): Promise<Db> {
  const url = process.env.DATABASE_URL;
  if (url) {
    const { Pool } = await import("pg");
    const pool = new Pool({ connectionString: url, max: 5, ssl: /sslmode=require|neon|supabase|amazonaws/.test(url) ? { rejectUnauthorized: false } : undefined });
    const db: Db = { kind: "postgres", query: async (sql, params) => (await pool.query(sql, params as unknown[])).rows };
    await pool.query(SCHEMA);
    return db;
  }
  if (process.env.NODE_ENV === "production" && process.env.VERCEL) {
    throw new Error("DATABASE_URL is required in production (serverless filesystem is not persistent).");
  }
  const { PGlite } = await import("@electric-sql/pglite");
  const dir = process.env.TREASURY_PGLITE_DIR || path.join(process.cwd(), ".data", "treasury-db");
  if (dir !== "memory://") mkdirSync(dir, { recursive: true });
  const pg = new PGlite(dir);
  await pg.exec(SCHEMA);
  return { kind: "pglite", query: async (sql, params) => (await pg.query(sql, params as unknown[])).rows as never };
}

export function db(): Promise<Db> {
  return (g.__sbDb ??= open().catch((e) => { g.__sbDb = undefined; throw e; }));
}

export async function q<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  return (await db()).query<T>(sql, params);
}

export const newId = (prefix: string) => `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;

/** Test helper: use an in-memory database. */
export function __useMemoryDb() {
  process.env.TREASURY_PGLITE_DIR = "memory://";
  g.__sbDb = undefined;
}
