import { CHAINS } from "@bajar/chain-adapters";

/** OpenAPI 3.1 description of the public market-data API (served at /api/v1/openapi.json). */
export function openApiSpec(serverUrl: string) {
  const chain = { name: "chain", in: "path", required: true, schema: { type: "string", enum: CHAINS.map((c) => c.id) } };
  const address = { name: "address", in: "path", required: true, schema: { type: "string" }, description: "Token mint (Solana) or contract address (EVM)." };
  const chainQ = { name: "chain", in: "query", schema: { type: "string", enum: CHAINS.map((c) => c.id), default: "solana" } };
  const ok = (ref: string, list = false) => ({
    200: { description: "OK", content: { "application/json": { schema: { type: "object", required: ["data", "meta"], properties: { data: list ? { type: "array", items: { $ref: ref } } : { $ref: ref }, meta: { $ref: "#/components/schemas/Meta" } } } } } },
    400: { $ref: "#/components/responses/BadRequest" }, 404: { $ref: "#/components/responses/NotFound" }, 429: { $ref: "#/components/responses/RateLimited" }, 502: { $ref: "#/components/responses/Unavailable" },
  });
  const nullNum = { type: ["number", "null"] };
  const win = { type: "object", properties: { m5: nullNum, h1: nullNum, h6: nullNum, h24: nullNum } };
  const tok = { type: "object", properties: { address: { type: "string" }, symbol: { type: "string" }, name: { type: "string" }, image: { type: ["string", "null"] } } };
  return {
    openapi: "3.1.0",
    info: {
      title: "BAJAR Market Data API",
      version: "1.0.0",
      description: "Read-only, real-time token and liquidity-pool data for Solana, Base, Arbitrum, Ethereum and BNB Chain. No account needed: 60 requests/min per IP, 600/min with an API key (header x-api-key). Values a provider doesn't report are null — never estimated. When upstream data is unavailable the API returns 502/503 rather than stale or simulated numbers (cached values are marked meta.stale).",
      license: { name: "Apache-2.0", url: "https://www.apache.org/licenses/LICENSE-2.0" },
    },
    servers: [{ url: serverUrl }],
    paths: {
      "/api/v1/chains": { get: { summary: "Supported chains", tags: ["Reference"], responses: ok("#/components/schemas/Chain", true) } },
      "/api/v1/search": { get: { summary: "Search tokens by name, symbol or contract address", tags: ["Discovery"], parameters: [{ name: "q", in: "query", required: true, schema: { type: "string", minLength: 2 } }, { ...chainQ, required: false, schema: { type: "string", enum: CHAINS.map((c) => c.id) } }], responses: ok("#/components/schemas/Pool", true) } },
      "/api/v1/tokens/trending": { get: { summary: "Trending pools", tags: ["Discovery"], parameters: [chainQ, { name: "window", in: "query", schema: { type: "string", enum: ["5m", "1h", "6h", "24h"], default: "24h" } }], responses: ok("#/components/schemas/Pool", true) } },
      "/api/v1/tokens/new": { get: { summary: "Newly created pools", tags: ["Discovery"], parameters: [chainQ], responses: ok("#/components/schemas/Pool", true) } },
      "/api/v1/tokens/top": { get: { summary: "Top pools by 24h volume", tags: ["Discovery"], parameters: [chainQ], responses: ok("#/components/schemas/Pool", true) } },
      "/api/v1/tokens/{chain}/{address}": { get: { summary: "Token profile", tags: ["Tokens"], parameters: [chain, address], responses: ok("#/components/schemas/Token") } },
      "/api/v1/tokens/{chain}/{address}/pools": { get: { summary: "A token's liquidity pools (deepest first)", tags: ["Tokens"], parameters: [chain, address], responses: ok("#/components/schemas/Pool", true) } },
      "/api/v1/tokens/{chain}/{address}/risk": { get: { summary: "Token risk intelligence", tags: ["Tokens"], parameters: [chain, address], responses: ok("#/components/schemas/Risk") } },
      "/api/v1/pools/{chain}/{address}": { get: { summary: "Pool", tags: ["Pools"], parameters: [chain, { ...address, description: "Pool (pair) address." }], responses: ok("#/components/schemas/Pool") } },
      "/api/v1/pools/{chain}/{address}/ohlcv": { get: { summary: "Candles (ascending)", tags: ["Pools"], parameters: [chain, { ...address, description: "Pool (pair) address." }, { name: "tf", in: "query", schema: { type: "string", enum: ["1m", "5m", "15m", "1h", "4h", "1d"], default: "1h" } }, { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 1000, default: 300 } }, { name: "before", in: "query", schema: { type: "integer" }, description: "Unix seconds; candles before this time." }], responses: ok("#/components/schemas/Candle", true) } },
      "/api/v1/pools/{chain}/{address}/trades": { get: { summary: "Latest swaps", tags: ["Pools"], parameters: [chain, { ...address, description: "Pool (pair) address." }], responses: ok("#/components/schemas/Trade", true) } },
      "/api/v1/pools/{chain}/{address}/history": { get: { summary: "Indexed snapshots (price, liquidity, volume over time) from the BAJAR indexer", tags: ["Pools"], parameters: [chain, { ...address, description: "Pool (pair) address." }, { name: "hours", in: "query", schema: { type: "integer", minimum: 1, maximum: 720, default: 24 } }], responses: ok("#/components/schemas/Snapshot", true) } },
      "/api/v1/stream/pools/{chain}/{address}": { get: { summary: "Live pool updates (Server-Sent Events: pool, trades, unavailable)", tags: ["Streaming"], parameters: [chain, { ...address, description: "Pool (pair) address." }], responses: { 200: { description: "text/event-stream" } } } },
    },
    components: {
      schemas: {
        Meta: { type: "object", properties: { source: { type: "string" }, fetchedAt: { type: "string", format: "date-time" }, stale: { type: "boolean" }, warning: { type: "string" } } },
        Chain: { type: "object", properties: { id: { type: "string" }, name: { type: "string" }, kind: { type: "string", enum: ["solana", "evm"] }, phase: { type: "integer" }, evmChainId: { type: ["integer", "null"] }, nativeSymbol: { type: "string" } } },
        Pool: { type: "object", properties: { chain: { type: "string" }, address: { type: "string" }, dex: { type: "string" }, name: { type: "string" }, base: tok, quote: tok, priceUsd: nullNum, liquidityUsd: nullNum, fdvUsd: nullNum, marketCapUsd: nullNum, volumeUsd: win, priceChangePct: win, createdAt: { type: ["integer", "null"], description: "Unix ms" }, source: { type: "string" } } },
        Token: { type: "object", properties: { chain: { type: "string" }, address: { type: "string" }, symbol: { type: "string" }, name: { type: "string" }, image: { type: ["string", "null"] }, priceUsd: nullNum, marketCapUsd: nullNum, fdvUsd: nullNum, liquidityUsd: nullNum, volume24hUsd: nullNum, priceChange24hPct: nullNum, holders: { type: ["integer", "null"] }, topPool: { type: ["string", "null"] }, poolCount: { type: "integer" }, source: { type: "string" } } },
        Candle: { type: "object", properties: { time: { type: "integer", description: "Unix seconds" }, open: { type: "number" }, high: { type: "number" }, low: { type: "number" }, close: { type: "number" }, volume: { type: "number" } } },
        Trade: { type: "object", properties: { txHash: { type: "string" }, time: { type: "integer" }, side: { type: "string", enum: ["buy", "sell"] }, priceUsd: nullNum, amountUsd: nullNum, baseAmount: nullNum, wallet: { type: ["string", "null"] } } },
        Risk: { type: "object", properties: { level: { type: "string", enum: ["low", "medium", "high", "unknown"] }, honeypot: { type: ["boolean", "null"] }, buyTaxPct: nullNum, sellTaxPct: nullNum, permissions: { type: "object" }, holders: { type: "object", properties: { count: { type: ["integer", "null"] }, top10Pct: nullNum } }, lockedLiquidityPct: nullNum, signals: { type: "array", items: { type: "object", properties: { key: { type: "string" }, level: { type: "string" }, label: { type: "string" }, detail: { type: "string" } } } } } },
        Snapshot: { type: "object", properties: { time: { type: "string", format: "date-time" }, priceUsd: nullNum, liquidityUsd: nullNum, volume24hUsd: nullNum, fdvUsd: nullNum } },
        Error: { type: "object", properties: { error: { type: "object", properties: { code: { type: "string" }, message: { type: "string" } } } } },
      },
      responses: {
        BadRequest: { description: "Invalid chain, address or parameter", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        NotFound: { description: "Not found", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        RateLimited: { description: "Rate limited (see Retry-After)", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        Unavailable: { description: "Upstream market data unavailable", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
      },
      securitySchemes: { apiKey: { type: "apiKey", in: "header", name: "x-api-key" } },
    },
  };
}
