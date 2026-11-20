-- BAJAR market index: pools, tokens, listing events and time-series snapshots.
-- Plain PostgreSQL works; with TimescaleDB, pool_snapshots becomes a hypertable
-- with compression and retention (see the DO block at the end).

create table if not exists market_tokens (
  chain        text not null,
  address      text not null,
  symbol       text not null,
  name         text not null,
  image        text,
  first_seen   timestamptz not null default now(),
  last_seen    timestamptz not null default now(),
  primary key (chain, address)
);

create table if not exists market_pools (
  chain          text not null,
  address        text not null,
  dex            text not null,
  name           text not null,
  base_address   text not null,
  quote_address  text not null,
  quote_symbol   text not null,
  created_at     timestamptz,
  first_seen     timestamptz not null default now(),
  last_seen      timestamptz not null default now(),
  primary key (chain, address)
);
create index if not exists market_pools_base on market_pools (chain, base_address);
create index if not exists market_pools_created on market_pools (chain, created_at desc);

create table if not exists pool_snapshots (
  time            timestamptz not null,
  chain           text not null,
  address         text not null,
  price_usd       double precision,
  liquidity_usd   double precision,
  volume_24h_usd  double precision,
  fdv_usd         double precision,
  market_cap_usd  double precision,
  buys_24h        integer,
  sells_24h       integer,
  source          text not null,
  primary key (chain, address, time)
);
create index if not exists pool_snapshots_time on pool_snapshots (time desc);

-- Listing activity: a pool first seen in "new pools", entering trending, etc.
create table if not exists market_events (
  id       bigserial,
  time     timestamptz not null default now(),
  chain    text not null,
  kind     text not null check (kind in ('new_pool', 'trending', 'top_volume')),
  address  text not null,
  rank     integer,
  primary key (id)
);
create index if not exists market_events_recent on market_events (chain, kind, time desc);

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'timescaledb') then
    create extension if not exists timescaledb;
    perform create_hypertable('pool_snapshots', 'time', if_not_exists => true, migrate_data => true);
    begin
      alter table pool_snapshots set (timescaledb.compress, timescaledb.compress_segmentby = 'chain, address');
      perform add_compression_policy('pool_snapshots', interval '7 days', if_not_exists => true);
      perform add_retention_policy('pool_snapshots', interval '180 days', if_not_exists => true);
    exception when others then
      raise notice 'TimescaleDB policies not applied: %', sqlerrm;
    end;
  end if;
end $$;
