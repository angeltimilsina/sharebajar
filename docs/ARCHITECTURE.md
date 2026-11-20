# BAJAR architecture

BAJAR is an open-source (Apache-2.0) cross-chain token discovery, launchpad,
decentralized trading and agentic commerce platform. This page maps the target
architecture to what exists in this repository today, and what is still open.

## Repository layout

```
src/                         Next.js 16 app (App Router): UI + API route handlers ("apps/web" + "apps/api")
  app/                       pages: / (Markets) /discover /token/[chain]/[address] /trade /launchpad /agents /wallet /developers …
  app/api/v1/                public market-data API (versioned, OpenAPI 3.1, rate-limited, CORS)
  app/api/*                  app APIs: auth gateway, swaps, launch, commerce, treasury, AI …
  lib/                       app services (market data, wallet, launch, commerce, treasury, auth)
packages/
  chain-adapters/            @bajar/chain-adapters — one ChainAdapter interface + unified schema, Solana/Base/Arbitrum/Ethereum/BNB
services/
  indexer/                   standalone worker: pools, tokens, listing events, per-minute snapshots → Postgres/TimescaleDB
contracts/                   EVM token template (BajarToken) for the launchpad
docs/                        architecture, deploy, wallet, treasury, fees
tests/                       unit (vitest) and end-to-end (Playwright)
docker-compose.yml           web + indexer + TimescaleDB + Redis
```

The target layout (`apps/web`, `apps/api`, `packages/{ui,wallet-sdk,swap-router,launchpad-sdk,agent-sdk,checkout-sdk}`,
`services/{risk-engine,agent-orchestrator,payment-orchestrator}`) is reached by
**extracting** working modules from `src/lib` into packages one at a time, as was
done for `packages/chain-adapters` — never by a rewrite. The web app still deploys
from the repository root on Vercel, so moving it under `apps/web` needs the
Vercel project's root directory changed at the same time.

| Target module | Where it lives now | Status |
| --- | --- | --- |
| packages/chain-adapters | `packages/chain-adapters` | Extracted; used by `/api/v1` and the indexer |
| packages/market-data | `src/lib/market/*` (CoinLore, Binance, DexScreener, GeckoTerminal, DefiLlama) | In app |
| packages/token-indexer · services/indexer | `services/indexer` | Extracted; runs standalone |
| services/risk-engine | `packages/chain-adapters/src/providers/goplus.ts`, `src/lib/security/*` | GoPlus-based scoring |
| packages/wallet-sdk | `src/lib/wallet/*`, `src/lib/bajar/*` (Bajar Wallet) | In app |
| packages/swap-router | `src/lib/trading/*`, `src/lib/bajar/server/*` (Jupiter, 0x, LI.FI) | In app |
| packages/launchpad-sdk | `src/lib/launch/*`, `contracts/` | In app |
| packages/agent-sdk · services/agent-orchestrator | `src/lib/commerce/agents.ts`, `src/lib/ai/*` | In app |
| packages/checkout-sdk · services/payment-orchestrator | `src/lib/commerce/orders.ts` | Sandbox provider only |
| packages/ui | `src/components/ui/*` + `src/app/globals.css` tokens | In app |

## Data flow (discovery)

```
GeckoTerminal ─┐                       ┌─► /api/v1/* (cached, stale-while-error, 60/min per IP)
DexScreener  ──┼─► @bajar/chain-adapters ┤
GoPlus       ──┘                       └─► services/indexer ─► Postgres/TimescaleDB ─► /api/v1/pools/…/history
Binance WS ───────────────────────────────► browser (live CEX prices)
GeckoTerminal trades/pool (5 s cache) ────► /api/v1/stream/pools/… (Server-Sent Events) ─► browser
```

- **Adapters** normalize every provider into one schema (`PoolSummary`, `TokenSummary`,
  `Candle`, `Trade`, `RiskSummary`). Missing values are `null`, never estimated.
- **Caching**: the app's `cached()` serves fresh data within a TTL and the last good
  value (flagged `stale`) when an upstream fails; with nothing cached the API returns
  502/503. Every response carries `meta.source` and `meta.fetchedAt`.
- **Indexer**: one pass per chain per interval (new pools, trending, top volume), paced to
  the free GeckoTerminal tier (≈30 calls/min); set `COINGECKO_API_KEY` for production
  volumes. Snapshots are idempotent per minute; listing events are recorded once per
  pool and feed. After each pass it sends `NOTIFY bajar_market` for push fan-out.

## Real-time

- CEX prices: Binance public WebSocket, straight to the browser.
- DEX pools: Server-Sent Events from `/api/v1/stream/pools/{chain}/{address}`; all
  subscribers share one cached upstream poll (5 s). Streams last ~55 s (serverless
  limit) and `EventSource` reconnects automatically.
- A dedicated WebSocket gateway (fed by the indexer's `NOTIFY`, Redis pub/sub for
  multiple instances) is the next step when an always-on host is used; the current
  Vercel deployment can't hold WebSocket connections.

## Security model

- One authentication gateway (`src/lib/server/gateway.ts`): a session exists only after
  the server verifies a wallet signature; sessions are recorded server-side and revocable.
- Noncustodial: no seed phrases or private keys reach the server or AI agents; every
  swap, launch and payment is signed by the user's wallet after simulation where supported.
- Agents can prepare purchases but never pay; payments require a wallet signature over the
  exact quote, are idempotent, rate-limited and fraud-checked.
- Inputs are validated at the edge (addresses per chain kind before any network call).
- Merchant and token content is treated as data, never as instructions to agents.

## Running locally

```bash
npm ci
npm run dev                      # web on :3000 (embedded Postgres under .data/ if no DATABASE_URL)
npm run indexer:once             # one indexing pass (embedded Postgres under .data/indexer-db)
npm test && npm run typecheck    # unit tests and types
docker compose up --build        # full stack with TimescaleDB (needs Docker)
```

The indexer runs TypeScript directly on Node ≥ 22.18 (type stripping), no build step.
In Docker Compose it uses the repository's `node_modules`, so run `npm ci` on a Linux host first.

## Open dependencies

| Need | Unlocks |
| --- | --- |
| `COINGECKO_API_KEY` | GeckoTerminal data at paid limits (the free tier rate-limits shared IPs) |
| Always-on host (or managed worker) + `DATABASE_URL` for the indexer | `/history` endpoints, listing events, long-range analytics |
| Payment provider partnership | Real BAJAR Pay purchases (sandbox today) |
| Retailer API access (eBay, Best Buy, Amazon, Walmart) | Live merchant catalogs beyond public Shopify data |
| Legal/security review | Public token fundraising (not implemented, by design) |
| Audit of `contracts/` + testnet deployment | Launchpad EVM template sign-off |
