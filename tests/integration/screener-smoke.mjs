// Screener / discovery / wallet API smoke test with real-data sanity checks.
// Run against a running server: BASE=http://localhost:3100 NODE_USE_ENV_PROXY=1 node tests/integration/screener-smoke.mjs
const BASE = process.env.BASE ?? "http://localhost:3000";
let fails = 0, warns = 0;
const check = (ok, label, extra = "") => { console.log(`${ok ? "✓" : "✗"} ${label}${extra ? ` — ${extra}` : ""}`); if (!ok) fails++; };
const warn = (label) => { console.log(`! ${label}`); warns++; };
const once = async (p) => { const t = Date.now(); const r = await fetch(BASE + p); let b = null; try { b = await r.json(); } catch { /* not json */ } return { status: r.status, body: b, ms: Date.now() - t }; };
// Like the UI's poller: if an upstream is rate-limiting, wait as told and retry (max 2x).
const get = async (p) => {
  let r = await once(p);
  for (let i = 0; i < 2 && r.status === 429 && r.body?.retryAfter; i++) { console.log(`  … ${p.split("?")[0]} rate-limited upstream, retrying in ${r.body.retryAfter}s`); await new Promise((x) => setTimeout(x, r.body.retryAfter * 1000 + 500)); r = await once(p); }
  return r;
};
const data = (b) => b?.data ?? b;

// Market overview + coin list (real prices)
const ov = await get("/api/market/overview");
check(ov.status === 200 && data(ov.body), "market overview", `${ov.ms}ms`);
const coins = await get("/api/market/coins");
const list = data(coins.body);
const btc = Array.isArray(list) ? list.find((c) => /^btc$/i.test(c.symbol)) : null;
check(Array.isArray(list) && list.length >= 50, "coin list", `${list?.length} coins`);
check(btc && btc.price > 1000 && btc.price < 10_000_000, "BTC price is sane", btc ? `$${btc.price}` : "missing");

// Binance live tickers
const tk = await get("/api/binance/tickers?symbols=BTCUSDT,ETHUSDT,SOLUSDT");
const tkd = data(tk.body);
check(tk.status === 200 && Array.isArray(tkd) && tkd.length === 3, "binance tickers", `${tkd?.length}`);

// Candles (never fabricated: OHLC must be internally consistent)
const cd = await get("/api/candles?symbol=BTCUSDT&res=1m");
const cdd = data(cd.body);
check(Array.isArray(cdd) && cdd.length > 50 && cdd.every((c) => c.high >= c.low && c.high >= Math.max(c.open, c.close) && c.low <= Math.min(c.open, c.close)), "1m candles OHLC consistent", `${cdd?.length} bars`);
const cds = await get("/api/candles?symbol=SOLUSDT&res=1s");
check(Array.isArray(data(cds.body)) && data(cds.body).length > 50, "1s candles", `${data(cds.body)?.length}`);

// DEX screener feeds per network
for (const [feed, net] of [["trending", ""], ["new", ""], ["trending", "solana"], ["new", "base"], ["top", "ethereum"], ["trending", "bsc"]]) {
  const r = await get(`/api/dex/pools?feed=${feed}${net ? `&network=${net}` : ""}`);
  const d = data(r.body);
  check(r.status === 200 && Array.isArray(d) && d.length > 0, `dex ${feed}${net ? ` (${net})` : ""}`, `${d?.length ?? 0} pools, ${r.ms}ms`);
}
const prof = await get("/api/dex/profiles?kind=latest");
check(prof.status === 200, "dex token profiles", `${data(prof.body)?.length ?? 0}`);

// Drill into a trending Solana token
const tr = data((await get("/api/dex/pools?feed=trending&network=solana")).body) ?? [];
const pool = tr[0];
if (pool) console.log("  sample pool keys:", Object.keys(pool).slice(0, 14).join(","));
const tokenAddr = pool?.baseToken?.address ?? pool?.base?.address ?? pool?.tokenAddress ?? pool?.baseAddress;
const poolAddr = pool?.address ?? pool?.pairAddress ?? pool?.poolAddress;
if (tokenAddr) {
  check((await get(`/api/dex/info?chain=solana&address=${tokenAddr}`)).status === 200, "token info", tokenAddr.slice(0, 8));
  const pairs = await get(`/api/dex/pairs?chain=solana&address=${tokenAddr}`);
  check(pairs.status === 200 && (data(pairs.body)?.length ?? 0) > 0, "token pairs", `${data(pairs.body)?.length ?? 0}`);
  const sec = await get(`/api/security?chain=solana&address=${tokenAddr}`);
  check(sec.status === 200, "token security check", `status ${sec.status}`);
} else warn("no token address on first trending pool");
if (poolAddr) {
  const trd = await get(`/api/dex/trades?chain=solana&pool=${poolAddr}`);
  check(trd.status === 200 && Array.isArray(data(trd.body)), "pool trades", `${data(trd.body)?.length ?? 0}`);
  const oh = await get(`/api/dex/ohlcv?chain=solana&pool=${poolAddr}&res=5m`);
  const ohd = data(oh.body);
  check(oh.status === 200 && Array.isArray(ohd) && ohd.every((c) => c.high >= c.low), "pool OHLCV consistent", `${ohd?.length ?? 0} bars`);
} else warn("no pool address on first trending pool");

// EVM token security (USDC on Ethereum)
check((await get("/api/security?chain=ethereum&address=0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48")).status === 200, "EVM token security (USDC)");

// Search
for (const q of ["bitcoin", "sol", "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"]) {
  const s = await get(`/api/search?q=${encodeURIComponent(q)}`);
  const sd = data(s.body);
  const n = Array.isArray(sd) ? sd.length : Object.values(sd ?? {}).filter(Array.isArray).flat().length;
  check(s.status === 200 && n > 0, `search "${q.slice(0, 12)}"`, `${n} results`);
}

// Coin detail, networks, news, health
check((await get("/api/market/coin?id=bitcoin")).status === 200, "coin detail (bitcoin)");
check((await get("/api/networks")).status === 200, "networks");
const news = await get("/api/news?limit=5");
check(news.status === 200, "news", `${data(news.body)?.length ?? 0} items`);
check((await get("/api/health")).status === 200, "health");

// Swap quotes
const jq = await get("/api/swap/quote?inputMint=So11111111111111111111111111111111111111112&outputMint=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v&amount=100000000&slippageBps=50");
check(jq.status === 200 && Number(data(jq.body)?.outAmount) > 0, "Jupiter SOL→USDC quote", data(jq.body)?.outAmount ?? jq.body?.error);
const lq = await get("/api/swap/lifi?fromNetwork=bitcoin&toNetwork=solana&fromToken=bitcoin&toToken=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v&fromAmount=1000000&fromAddress=bc1qgdjqv0av3q56jvd82tkdjpy7gdp9ut8tlqmgrpmv24sq90ecnvqqjwvw97&toAddress=HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk&slippage=0.01");
check(lq.status === 200 && !!lq.body?.quote?.transactionRequest, "LI.FI native BTC→USDC route", lq.body?.quote?.tool ?? lq.body?.error);

// Wallet APIs (public addresses only)
const pf = await get("/api/wallet/portfolio?btc=bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu&evm=0x9858EfFD232B4033E47d90003D41EC34EcaEda94&sol=HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk");
const pfd = data(pf.body);
check(pf.status === 200 && Array.isArray(pfd?.holdings), "wallet portfolio (multi-chain)", `${pfd?.holdings?.length} holdings, $${pfd?.totalUsd?.toFixed?.(2)}`);
check((pfd?.holdings ?? []).every((h) => h.usdValue === null || (h.usdPrice > 0 && Math.abs(h.usdValue - h.amount * h.usdPrice) < 0.01)), "portfolio values = amount × price");
const fees = await get("/api/wallet/btc?op=fees");
check(fees.status === 200 && fees.body?.fastestFee >= 1, "BTC fee rates", `${fees.body?.fastestFee} sat/vB`);
check((await get("/api/wallet/history?solana=HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk")).status === 200, "Solana history");
const tok = await get("/api/wallet/token?network=solana&token=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
check(tok.status === 200 && tok.body?.decimals === 6, "custom token validation", tok.body?.symbol ?? tok.body?.error);

console.log(`\n${fails ? `${fails} failed` : "all checks passed"}${warns ? `, ${warns} warning(s)` : ""}`);
process.exit(fails ? 1 : 0);
