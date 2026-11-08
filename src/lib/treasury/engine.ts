import "server-only";
import { q, newId } from "./db";
import { listTreasuries, type Treasury } from "./store";
import { alert, audit } from "./audit";
import { appendLedger } from "./ledger";
import { priceAt } from "./prices";
import { classify, reconcile, splitProviderShare, toDecimal } from "./classify";
import { srpc, SWAP_PROGRAMS } from "./solana";
import { erpc, hexToBig, pad32, topicToAddress, TRANSFER_TOPIC } from "./evm";
import { CONFIRMATIONS, KNOWN_TOKENS, knownToken, WSOL } from "./tokens";
import { getChain } from "../chains";
import { log } from "../server/log";

/**
 * Revenue tracking engine.
 *  1. Scan each treasury's fee accounts / receiving address for new activity.
 *  2. Classify each balance change (platform revenue vs. plain transfer).
 *  3. Verify reported swap intents against the actual transaction.
 *  4. Track confirmations; detect dropped / reorged transactions.
 *  5. Value at the block-time price and post confirmed revenue to the ledger.
 * Idempotent: re-running never double-counts (unique chain+tx+log+recipient).
 */
export interface IndexSummary { treasuries: number; scanned: number; newEvents: number; confirmed: number; orphaned: number; intentsChecked: number; errors: string[]; startedAt: string; finishedAt: string }

const ZEROX_ALLOWANCE_HOLDER = "0x0000000000001ff3684f28c67538d4d072c22734";
const SOL_BACKFILL = Number(process.env.TREASURY_SOLANA_BACKFILL ?? 50);
const EVM_BACKFILL = Number(process.env.TREASURY_EVM_BACKFILL_BLOCKS ?? 2000);
const EVM_CHUNK = 2000;

let running = false;

export async function runIndexer(opts: { treasuryId?: string; actor?: string; rescan?: boolean } = {}): Promise<IndexSummary> {
  if (running) throw new Error("Indexer already running");
  running = true;
  const s: IndexSummary = { treasuries: 0, scanned: 0, newEvents: 0, confirmed: 0, orphaned: 0, intentsChecked: 0, errors: [], startedAt: new Date().toISOString(), finishedAt: "" };
  try {
    const all = (await listTreasuries()).filter((t) => t.integrityOk && t.status !== "disabled" && (!opts.treasuryId || t.id === opts.treasuryId));
    s.treasuries = all.length;
    if (opts.rescan) for (const t of all) await q("delete from index_cursors where treasury_id=$1", [t.id]);
    for (const t of all) {
      try {
        if (t.chainType === "solana") await indexSolana(t, s);
        else await indexEvm(t, s);
      } catch (e) {
        s.errors.push(`${t.label}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    try { await verifyIntents(s); } catch (e) { s.errors.push(`intents: ${String(e)}`); }
    try { await recheckPending(s); } catch (e) { s.errors.push(`recheck: ${String(e)}`); }
    try { await postLedger(s); } catch (e) { s.errors.push(`ledger: ${String(e)}`); }
  } finally {
    running = false;
    s.finishedAt = new Date().toISOString();
    await audit({ actor: opts.actor ?? "system:indexer", action: "indexer.run", outcome: s.errors.length ? "error" : "ok", details: s });
    if (s.errors.length) log("warn", "indexer errors", { errors: s.errors });
  }
  return s;
}

/* ------------------------------------------------------------------ */
/* Persistence helpers                                                 */
/* ------------------------------------------------------------------ */

interface EventInput {
  chain: string; txHash: string; logIndex: number; treasury: Treasury | null; feeRecipient: string; token: string; symbol: string; decimals: number;
  amountRaw: bigint; direction: "in" | "out"; isFeeAccount: boolean; swapProgramInvoked: boolean; txFailed: boolean;
  status: "pending" | "confirmed" | "reverted"; confirmations: number; blockNumber: number | null; blockHash: string | null; blockTime: number | null;
}

async function intentFor(chain: string, txHash: string) {
  const [r] = await q<{ id: string; mode: string; expected_fee: string | null; slippage_bps: number | null; provider_share_bps: number; is_test: boolean; provider: string; fee_account: string | null }>(
    "select id, mode, expected_fee, slippage_bps, provider_share_bps, is_test, provider, fee_account from swap_intents where chain=$1 and tx_hash=$2", [chain, txHash],
  );
  return r ?? null;
}

async function upsertEvent(e: EventInput): Promise<"new" | "updated"> {
  const intent = await intentFor(e.chain, e.txHash);
  const relevantIntent = intent && (!intent.fee_account || intent.fee_account === e.feeRecipient) ? intent : null;
  const c = classify({
    direction: e.direction, isFeeAccount: e.isFeeAccount, treasuryKind: e.treasury?.kind ?? "wallet", txFailed: e.txFailed, swapProgramInvoked: e.swapProgramInvoked,
    intent: relevantIntent ? { mode: relevantIntent.mode, expectedFee: relevantIntent.expected_fee, slippageBps: relevantIntent.slippage_bps, providerShareBps: relevantIntent.provider_share_bps } : null,
  });
  const shareBps = relevantIntent?.provider_share_bps ?? (e.treasury?.kind === "jupiter_referral" ? 2000 : 0);
  const { gross, share } = c.isRevenue ? splitProviderShare(e.amountRaw, shareBps) : { gross: e.amountRaw, share: BigInt(0) };
  const expected = relevantIntent?.expected_fee ? BigInt(String(relevantIntent.expected_fee).split(".")[0]) : null;
  const recon = reconcile(e.amountRaw, expected, relevantIntent?.slippage_bps ?? null, c.isRevenue, c.attribution === "intent");
  const when = e.blockTime ?? Date.now();
  const price = e.direction === "in" || e.direction === "out" ? await priceAt(e.chain, e.token, e.symbol, when) : { price: null, source: "" };
  const amount = toDecimal(e.amountRaw, e.decimals);
  const usd = price.price !== null ? Math.round(Number(amount) * price.price * 1e6) / 1e6 : null;
  const status = e.txFailed ? "reverted" : e.status;
  const existing = await q<{ id: string; status: string; is_revenue: boolean; source: string }>("select id, status, is_revenue, source from revenue_events where chain=$1 and tx_hash=$2 and log_index=$3 and fee_recipient=$4", [e.chain, e.txHash, e.logIndex, e.feeRecipient]);
  if (existing[0] && (existing[0].is_revenue !== c.isRevenue || existing[0].source !== c.source)) {
    // Classification changed (e.g. improved rules on re-scan): reverse prior ledger entries, never edit them.
    const prior = await q<{ entry_type: string; account: string; token: string; amount: string; usd_value: string | null }>(
      `select entry_type, account, token, amount, usd_value from ledger where event_id=$1 and entry_type in ('debit','credit','transfer_in','transfer_out')
       and seq > coalesce((select max(seq) from ledger where event_id=$1 and entry_type='reclass_reversal'), 0)`, [existing[0].id]);
    if (prior.length) {
      await appendLedger(prior.map((p) => ({ eventId: existing[0].id, entryType: "reclass_reversal", account: p.account, token: p.token, amount: String(p.amount).startsWith("-") ? String(p.amount).slice(1) : `-${p.amount}`, usdValue: p.usd_value === null ? null : -Number(p.usd_value), memo: `reclassified ${existing[0].source} → ${c.source}` })));
    }
  }
  if (existing[0]) {
    await q(
      `update revenue_events set status=$2, confirmations=$3, block_number=coalesce($4, block_number), block_hash=coalesce($5, block_hash), intent_id=coalesce(intent_id,$6), reconciliation=$7, source=$8, is_revenue=$9,
         gross_amount=$10, provider_share=$11, provider=$12, updated_at=now() where id=$1`,
      [existing[0].id, status, e.confirmations, e.blockNumber, e.blockHash, relevantIntent?.id ?? null, recon, c.source, c.isRevenue,
        toDecimal(gross, e.decimals), toDecimal(share, e.decimals), c.isRevenue ? (e.chain === "solana" ? "jupiter" : "0x") : null],
    );
    return "updated";
  }
  await q(
    `insert into revenue_events (id, chain, tx_hash, log_index, treasury_id, fee_recipient, token, token_symbol, decimals, amount_raw, amount, gross_amount, provider_share, direction, source, provider, is_revenue, status, confirmations, block_number, block_hash, block_time, usd_price, usd_value, price_source, intent_id, expected_amount, reconciliation, environment, is_test)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30)`,
    [newId("rev"), e.chain, e.txHash, e.logIndex, e.treasury?.id ?? null, e.feeRecipient, e.token, e.symbol, e.decimals, e.amountRaw.toString(), amount,
      toDecimal(gross, e.decimals), toDecimal(share, e.decimals), e.direction, c.source, c.isRevenue ? (e.chain === "solana" ? "jupiter" : "0x") : null, c.isRevenue, status, e.confirmations,
      e.blockNumber, e.blockHash, new Date(when).toISOString(), price.price, usd, price.source, relevantIntent?.id ?? null, expected === null ? null : toDecimal(expected, e.decimals), recon,
      // Fees reaching a treasury before it is active are test / pre-activation revenue, never production revenue.
      e.treasury?.environment ?? "mainnet", relevantIntent?.is_test ?? (e.treasury?.status !== "active")],
  );
  if (recon === "under" || recon === "over") void alert("warning", "reconciliation_mismatch", `Fee in ${e.txHash.slice(0, 12)}… was ${amount} ${e.symbol}, expected ${toDecimal(expected!, e.decimals)} (${recon}).`);
  if (e.direction === "out" && !e.txFailed) void alert("warning", "outgoing_transfer", `Outgoing ${amount} ${e.symbol} from ${e.treasury?.label ?? e.feeRecipient} in ${e.txHash.slice(0, 12)}…`);
  return "new";
}

async function getCursor(tid: string, account: string) {
  const [r] = await q<{ cursor: string | null }>("select cursor from index_cursors where treasury_id=$1 and account=$2", [tid, account]);
  return r?.cursor ?? null;
}
async function setCursor(tid: string, account: string, cursor: string) {
  await q("insert into index_cursors (treasury_id, account, cursor) values ($1,$2,$3) on conflict (treasury_id, account) do update set cursor=excluded.cursor, updated_at=now()", [tid, account, cursor]);
}

/* ------------------------------------------------------------------ */
/* Solana                                                              */
/* ------------------------------------------------------------------ */

interface SolTx {
  slot: number; blockTime: number | null;
  meta: { err: unknown; fee: number; preBalances: number[]; postBalances: number[]; preTokenBalances?: TokBal[]; postTokenBalances?: TokBal[]; innerInstructions?: { instructions: { programId?: string }[] }[]; logMessages?: string[] } | null;
  transaction: { message: { accountKeys: { pubkey: string; signer: boolean; writable: boolean }[]; instructions: { programId?: string }[] } };
}
interface TokBal { accountIndex: number; mint: string; owner?: string; uiTokenAmount: { amount: string; decimals: number } }

export async function getSolTx(sig: string, environment = "mainnet") {
  return srpc<SolTx | null>("getTransaction", [sig, { encoding: "jsonParsed", maxSupportedTransactionVersion: 0, commitment: "confirmed" }], environment);
}

/** Balance change of `account` in a parsed transaction (pure; exported for tests). */
export function solDelta(tx: SolTx, account: string): { kind: "token" | "sol"; mint: string; decimals: number; delta: bigint } | null {
  const keys = tx.transaction.message.accountKeys.map((k) => (typeof k === "string" ? k : k.pubkey));
  const i = keys.indexOf(account);
  if (i < 0 || !tx.meta) return null;
  const pre = tx.meta.preTokenBalances?.find((b) => b.accountIndex === i);
  const post = tx.meta.postTokenBalances?.find((b) => b.accountIndex === i);
  if (pre || post) {
    const b = (post ?? pre)!;
    return { kind: "token", mint: b.mint, decimals: b.uiTokenAmount.decimals, delta: BigInt(post?.uiTokenAmount.amount ?? "0") - BigInt(pre?.uiTokenAmount.amount ?? "0") };
  }
  let delta = BigInt(tx.meta.postBalances[i] - tx.meta.preBalances[i]);
  if (i === 0) delta += BigInt(tx.meta.fee); // separate the network fee (recorded as an expense)
  return { kind: "sol", mint: WSOL, decimals: 9, delta };
}

/**
 * Was this transaction a swap? Either a known aggregator program ran, or token
 * balances in ≥2 different mints changed (excluding the fee account itself).
 * Dedicated fee accounts receiving funds inside a swap ⇒ fee revenue; a plain
 * single-mint transfer into them ⇒ a deposit, not revenue.
 */
export function isSwapTx(tx: SolTx, feeAccount: string): boolean {
  const progs = programsInvoked(tx);
  for (const p of progs) if (SWAP_PROGRAMS.has(p)) return true;
  const keys = tx.transaction.message.accountKeys.map((k) => (typeof k === "string" ? k : k.pubkey));
  const changed = new Set<string>();
  const pre = new Map((tx.meta?.preTokenBalances ?? []).map((b) => [b.accountIndex, b]));
  for (const post of tx.meta?.postTokenBalances ?? []) {
    if (keys[post.accountIndex] === feeAccount) continue;
    if ((pre.get(post.accountIndex)?.uiTokenAmount.amount ?? "0") !== post.uiTokenAmount.amount) changed.add(post.mint);
  }
  return changed.size >= 2;
}

export function programsInvoked(tx: SolTx): Set<string> {
  const ids = new Set<string>();
  for (const ix of tx.transaction.message.instructions) if (ix.programId) ids.add(ix.programId);
  for (const inner of tx.meta?.innerInstructions ?? []) for (const ix of inner.instructions) if (ix.programId) ids.add(ix.programId);
  return ids;
}

async function indexSolana(t: Treasury, s: IndexSummary) {
  const cfg = t.feeConfig;
  const feeAccounts = new Map<string, { token: string; symbol: string; decimals: number }>();
  for (const tok of cfg?.tokens ?? []) if (tok.tokenAccount) feeAccounts.set(tok.tokenAccount, { token: tok.token, symbol: tok.symbol, decimals: tok.decimals });
  const accounts = [...feeAccounts.keys()];
  if (t.kind !== "jupiter_referral") accounts.push(t.address);
  for (const account of accounts) {
    const cursor = await getCursor(t.id, account);
    const sigs = await srpc<{ signature: string; slot: number; err: unknown; confirmationStatus: string | null; blockTime: number | null }[]>(
      "getSignaturesForAddress", [account, { limit: cursor ? 200 : SOL_BACKFILL, ...(cursor ? { until: cursor } : {}), commitment: "confirmed" }], t.environment,
    );
    if (!sigs.length) continue;
    for (const sig of [...sigs].reverse()) {
      s.scanned++;
      const tx = await getSolTx(sig.signature, t.environment);
      if (!tx?.meta) continue;
      const d = solDelta(tx, account);
      const isFee = feeAccounts.has(account);
      if (d && d.delta !== BigInt(0)) {
        const meta = feeAccounts.get(account);
        const known = knownToken("solana", d.mint);
        const r = await upsertEvent({
          chain: "solana", txHash: sig.signature, logIndex: 0, treasury: t, feeRecipient: account, token: d.mint, symbol: meta?.symbol ?? known?.symbol ?? d.mint.slice(0, 4),
          decimals: d.decimals, amountRaw: d.delta < BigInt(0) ? -d.delta : d.delta, direction: d.delta > BigInt(0) ? "in" : "out", isFeeAccount: isFee,
          swapProgramInvoked: isFee && isSwapTx(tx, account), txFailed: !!tx.meta.err,
          status: sig.confirmationStatus === "finalized" ? "confirmed" : "pending", confirmations: sig.confirmationStatus === "finalized" ? 32 : 1,
          blockNumber: tx.slot, blockHash: null, blockTime: tx.blockTime ? tx.blockTime * 1000 : null,
        });
        if (r === "new") s.newEvents++;
      }
      // Network fees paid by the treasury wallet are operating expenses.
      const keys = tx.transaction.message.accountKeys.map((k) => (typeof k === "string" ? k : k.pubkey));
      if (account === t.address && keys[0] === t.address) {
        const p = await priceAt("solana", WSOL, "SOL", (tx.blockTime ?? Date.now() / 1000) * 1000);
        const fee = tx.meta.fee / 1e9;
        await q("insert into expenses (id, chain, tx_hash, treasury_id, native_fee, native_symbol, usd_value, kind, block_time) values ($1,'solana',$2,$3,$4,'SOL',$5,'network_fee',$6) on conflict (chain, tx_hash) do nothing",
          [newId("exp"), sig.signature, t.id, fee, p.price ? fee * p.price : null, new Date((tx.blockTime ?? Date.now() / 1000) * 1000).toISOString()]);
      }
    }
    await setCursor(t.id, account, sigs[0].signature);
  }
}

/* ------------------------------------------------------------------ */
/* EVM                                                                 */
/* ------------------------------------------------------------------ */

interface Log { address: string; topics: string[]; data: string; blockNumber: string; blockHash: string; transactionHash: string; logIndex: string; removed?: boolean }
const blockTimes = new Map<string, number>();

async function blockTime(chain: string, num: string, env: string): Promise<number> {
  const k = `${chain}:${num}`;
  if (blockTimes.has(k)) return blockTimes.get(k)!;
  const b = await erpc<{ timestamp: string }>(chain, "eth_getBlockByNumber", [num, false], env);
  const ms = Number(hexToBig(b.timestamp)) * 1000;
  blockTimes.set(k, ms);
  if (blockTimes.size > 10_000) blockTimes.clear();
  return ms;
}

async function indexEvm(t: Treasury, s: IndexSummary) {
  const latest = Number(hexToBig(await erpc<string>(t.chain, "eth_blockNumber", [], t.environment)));
  const cursor = await getCursor(t.id, t.address);
  let from = cursor ? Number(cursor) + 1 : Math.max(0, latest - EVM_BACKFILL);
  const feeTokens = new Map((t.feeConfig?.tokens ?? []).map((x) => [x.token.toLowerCase(), x]));
  const watch = new Map<string, { token: string; symbol: string; decimals: number }>();
  for (const x of [...(KNOWN_TOKENS[t.chain] ?? []), ...(t.feeConfig?.tokens ?? [])]) watch.set(x.token.toLowerCase(), { token: x.token, symbol: x.symbol, decimals: x.decimals });
  const required = CONFIRMATIONS[t.chain] ?? 12;
  while (from <= latest) {
    const to = Math.min(latest, from + EVM_CHUNK - 1);
    const range = { fromBlock: `0x${from.toString(16)}`, toBlock: `0x${to.toString(16)}`, address: [...watch.keys()] };
    const [incoming, outgoing] = await Promise.all([
      erpc<Log[]>(t.chain, "eth_getLogs", [{ ...range, topics: [TRANSFER_TOPIC, null, pad32(t.address)] }], t.environment),
      erpc<Log[]>(t.chain, "eth_getLogs", [{ ...range, topics: [TRANSFER_TOPIC, pad32(t.address)] }], t.environment),
    ]);
    for (const [logs, direction] of [[incoming, "in"], [outgoing, "out"]] as const) {
      for (const l of logs) {
        if (l.removed) continue;
        s.scanned++;
        const tok = watch.get(l.address.toLowerCase())!;
        const bn = Number(hexToBig(l.blockNumber));
        const tx = await erpc<{ to: string | null }>(t.chain, "eth_getTransactionByHash", [l.transactionHash], t.environment);
        const viaZeroX = (tx?.to ?? "").toLowerCase() === ZEROX_ALLOWANCE_HOLDER;
        const conf = latest - bn + 1;
        const r = await upsertEvent({
          chain: t.chain, txHash: l.transactionHash, logIndex: Number(hexToBig(l.logIndex)), treasury: t, feeRecipient: t.address.toLowerCase(), token: tok.token, symbol: tok.symbol, decimals: tok.decimals,
          amountRaw: hexToBig(l.data), direction, isFeeAccount: direction === "in" && feeTokens.has(l.address.toLowerCase()), swapProgramInvoked: viaZeroX, txFailed: false,
          status: conf >= required ? "confirmed" : "pending", confirmations: conf, blockNumber: bn, blockHash: l.blockHash, blockTime: await blockTime(t.chain, l.blockNumber, t.environment),
        });
        if (r === "new") s.newEvents++;
        void topicToAddress;
      }
    }
    await setCursor(t.id, t.address, String(to));
    from = to + 1;
  }
}

/* ------------------------------------------------------------------ */
/* Intent verification                                                 */
/* ------------------------------------------------------------------ */

async function verifyIntents(s: IndexSummary) {
  const intents = await q<{ id: string; chain: string; tx_hash: string; treasury_id: string | null; fee_token: string | null; fee_account: string | null; expected_fee: string | null; mode: string; created_at: string | Date }>(
    "select id, chain, tx_hash, treasury_id, fee_token, fee_account, expected_fee, mode, created_at from swap_intents where status in ('submitted','pending') order by created_at limit 100",
  );
  const treasuries = new Map((await listTreasuries()).map((t) => [t.id, t]));
  for (const it of intents) {
    s.intentsChecked++;
    const age = Date.now() - new Date(it.created_at).getTime();
    const set = (status: string, detail: string) => q("update swap_intents set status=$2, status_detail=$3, updated_at=now() where id=$1", [it.id, status, detail.slice(0, 300)]);
    const t = it.treasury_id ? treasuries.get(it.treasury_id) ?? null : null;
    try {
      if (it.chain === "solana") {
        const tx = await getSolTx(it.tx_hash);
        if (!tx) { if (age > 5 * 60_000) await set("dropped", "Transaction not found on-chain (expired or never landed)."); continue; }
        if (tx.meta?.err) { await set("failed", `Transaction failed: ${JSON.stringify(tx.meta.err)}`); continue; }
        if (!it.fee_account || it.mode === "none") { await set("no_fee", "Swap confirmed; no platform fee was applicable."); continue; }
        const d = solDelta(tx, it.fee_account);
        if (d && d.delta > BigInt(0)) {
          const st = await srpc<{ value: ({ confirmationStatus: string } | null)[] }>("getSignatureStatuses", [[it.tx_hash], { searchTransactionHistory: true }]);
          const fin = st.value[0]?.confirmationStatus === "finalized";
          const meta = t?.feeConfig?.tokens.find((x) => x.tokenAccount === it.fee_account);
          const r = await upsertEvent({
            chain: "solana", txHash: it.tx_hash, logIndex: 0, treasury: t, feeRecipient: it.fee_account, token: d.mint, symbol: meta?.symbol ?? knownToken("solana", d.mint)?.symbol ?? d.mint.slice(0, 4),
            decimals: d.decimals, amountRaw: d.delta, direction: "in", isFeeAccount: true, swapProgramInvoked: true, txFailed: false,
            status: fin ? "confirmed" : "pending", confirmations: fin ? 32 : 1, blockNumber: tx.slot, blockHash: null, blockTime: tx.blockTime ? tx.blockTime * 1000 : null,
          });
          if (r === "new") s.newEvents++;
          await set(fin ? "fee_received" : "pending", fin ? "Fee received and finalized." : "Fee received; awaiting finality.");
        } else {
          await set("fee_missing", "Swap succeeded but no fee reached the fee account.");
          await alert("critical", "fee_missing", `Swap ${it.tx_hash.slice(0, 12)}… succeeded but the expected platform fee did not reach ${it.fee_account}.`);
        }
      } else {
        const rc = await erpc<{ status: string; blockNumber: string; blockHash: string; logs: Log[] } | null>(it.chain, "eth_getTransactionReceipt", [it.tx_hash]);
        if (!rc) { if (age > 15 * 60_000) await set("dropped", "No receipt (dropped or replaced)."); continue; }
        if (rc.status !== "0x1") { await set("failed", "Transaction reverted."); continue; }
        if (!it.fee_account || !it.fee_token || it.mode === "none") { await set("no_fee", "Swap confirmed; no platform fee was applicable."); continue; }
        const feeLog = rc.logs.find((l) => l.address.toLowerCase() === it.fee_token!.toLowerCase() && l.topics[0] === TRANSFER_TOPIC && topicToAddress(l.topics[2] ?? "").toLowerCase() === it.fee_account!.toLowerCase());
        if (!feeLog) {
          await set("fee_missing", "Swap succeeded but no fee Transfer to the treasury was found in the receipt.");
          await alert("critical", "fee_missing", `0x swap ${it.tx_hash.slice(0, 12)}… on ${it.chain} succeeded without the expected fee transfer.`);
          continue;
        }
        const latest = Number(hexToBig(await erpc<string>(it.chain, "eth_blockNumber", [])));
        const bn = Number(hexToBig(rc.blockNumber));
        const conf = latest - bn + 1;
        const required = CONFIRMATIONS[it.chain] ?? 12;
        const tok = t?.feeConfig?.tokens.find((x) => x.token.toLowerCase() === it.fee_token!.toLowerCase()) ?? knownToken(it.chain, it.fee_token);
        const r = await upsertEvent({
          chain: it.chain, txHash: it.tx_hash, logIndex: Number(hexToBig(feeLog.logIndex)), treasury: t, feeRecipient: it.fee_account.toLowerCase(), token: it.fee_token, symbol: tok?.symbol ?? "TOKEN", decimals: tok?.decimals ?? 18,
          amountRaw: hexToBig(feeLog.data), direction: "in", isFeeAccount: true, swapProgramInvoked: true, txFailed: false,
          status: conf >= required ? "confirmed" : "pending", confirmations: conf, blockNumber: bn, blockHash: rc.blockHash, blockTime: await blockTime(it.chain, rc.blockNumber, "mainnet"),
        });
        if (r === "new") s.newEvents++;
        await set(conf >= required ? "fee_received" : "pending", conf >= required ? `Fee received with ${conf} confirmations.` : `Fee received; ${conf}/${required} confirmations.`);
      }
    } catch (e) {
      log("warn", "intent verification failed", { id: it.id, error: String(e) });
    }
  }
}

/* ------------------------------------------------------------------ */
/* Confirmations, reorgs, dropped transactions                         */
/* ------------------------------------------------------------------ */

async function recheckPending(s: IndexSummary) {
  const rows = await q<{ id: string; chain: string; tx_hash: string; log_index: number; block_hash: string | null; environment: string; created_at: string | Date; amount_raw: string; token: string }>(
    "select id, chain, tx_hash, log_index, block_hash, environment, created_at, amount_raw, token from revenue_events where status='pending' limit 200",
  );
  for (const r of rows) {
    const age = Date.now() - new Date(r.created_at).getTime();
    try {
      if (r.chain === "solana") {
        const st = await srpc<{ value: ({ confirmationStatus: string; err: unknown } | null)[] }>("getSignatureStatuses", [[r.tx_hash], { searchTransactionHistory: true }], r.environment);
        const v = st.value[0];
        if (!v) { if (age > 10 * 60_000) { await q("update revenue_events set status='orphaned', updated_at=now() where id=$1", [r.id]); s.orphaned++; } continue; }
        if (v.err) { await q("update revenue_events set status='reverted', is_revenue=false, updated_at=now() where id=$1", [r.id]); continue; }
        if (v.confirmationStatus === "finalized") { await q("update revenue_events set status='confirmed', confirmations=32, updated_at=now() where id=$1", [r.id]); s.confirmed++; }
      } else {
        const rc = await erpc<{ status: string; blockNumber: string; blockHash: string; logs: Log[] } | null>(r.chain, "eth_getTransactionReceipt", [r.tx_hash], r.environment);
        if (!rc) { if (age > 30 * 60_000) { await q("update revenue_events set status='orphaned', updated_at=now() where id=$1", [r.id]); s.orphaned++; } continue; }
        const still = rc.status === "0x1" && rc.logs.some((l) => Number(hexToBig(l.logIndex)) === Number(r.log_index) && l.address.toLowerCase() === r.token.toLowerCase() && hexToBig(l.data).toString() === String(r.amount_raw));
        if (!still) { await q("update revenue_events set status='orphaned', updated_at=now() where id=$1", [r.id]); s.orphaned++; void alert("warning", "reorg", `Event in ${r.tx_hash.slice(0, 12)}… on ${r.chain} disappeared after a reorg.`); continue; }
        const latest = Number(hexToBig(await erpc<string>(r.chain, "eth_blockNumber", [], r.environment)));
        const conf = latest - Number(hexToBig(rc.blockNumber)) + 1;
        const required = CONFIRMATIONS[r.chain] ?? 12;
        await q("update revenue_events set confirmations=$2, block_hash=$3, block_number=$4, status=$5, updated_at=now() where id=$1", [r.id, conf, rc.blockHash, Number(hexToBig(rc.blockNumber)), conf >= required ? "confirmed" : "pending"]);
        if (conf >= required) s.confirmed++;
      }
    } catch (e) {
      log("warn", "pending recheck failed", { id: r.id, error: String(e) });
    }
  }
}

/* ------------------------------------------------------------------ */
/* Ledger posting                                                      */
/* ------------------------------------------------------------------ */

async function postLedger(s: IndexSummary) {
  // Confirmed events without ledger entries.
  const confirmed = await q<{ id: string; chain: string; treasury_id: string | null; token_symbol: string | null; token: string; amount: string; provider_share: string; usd_value: string | null; usd_price: string | null; source: string; provider: string | null; direction: string; is_revenue: boolean; tx_hash: string }>(
    `select e.* from revenue_events e where e.status='confirmed' and not exists (
       select 1 from ledger l where l.event_id=e.id and l.entry_type in ('debit','credit','transfer_in','transfer_out')
       and l.seq > coalesce((select max(seq) from ledger r where r.event_id=e.id and r.entry_type='reclass_reversal'), 0))
     order by e.block_time limit 500`,
  );
  for (const e of confirmed) {
    const asset = `assets:${e.chain}:${e.treasury_id ?? "unknown"}:${e.token_symbol ?? e.token}`;
    const usd = e.usd_value === null ? null : Number(e.usd_value);
    if (e.is_revenue) {
      const entries = [
        { eventId: e.id, entryType: "debit", account: asset, token: e.token, amount: String(e.amount), usdValue: usd, memo: `fee received ${e.tx_hash}` },
        { eventId: e.id, entryType: "credit", account: `revenue:${e.source}:${e.provider ?? "unknown"}:${e.chain}`, token: e.token, amount: String(e.amount), usdValue: usd, memo: `net platform fee ${e.tx_hash}` },
      ];
      if (Number(e.provider_share) > 0) {
        const shareUsd = e.usd_price === null ? null : Math.round(Number(e.provider_share) * Number(e.usd_price) * 1e6) / 1e6;
        entries.push({ eventId: e.id, entryType: "memo", account: `provider_share:${e.provider}:${e.chain}`, token: e.token, amount: String(e.provider_share), usdValue: shareUsd, memo: "retained by provider (not received by treasury)" });
      }
      await appendLedger(entries);
    } else {
      await appendLedger([{ eventId: e.id, entryType: e.direction === "in" ? "transfer_in" : "transfer_out", account: asset, token: e.token, amount: String(e.direction === "in" ? e.amount : `-${e.amount}`), usdValue: usd === null ? null : e.direction === "in" ? usd : -usd, memo: `${e.source} ${e.tx_hash}` }]);
    }
  }
  // Events that were ledgered but later orphaned/reverted get reversal entries.
  const reversed = await q<{ id: string; token: string; amount: string; usd_value: string | null; tx_hash: string; status: string }>(
    `select e.id, e.token, e.amount, e.usd_value, e.tx_hash, e.status from revenue_events e
     where e.status in ('orphaned','reverted') and exists (select 1 from ledger l where l.event_id=e.id and l.entry_type in ('debit','transfer_in','transfer_out'))
       and not exists (select 1 from ledger l where l.event_id=e.id and l.entry_type='reversal')`,
  );
  for (const e of reversed) {
    await appendLedger([{ eventId: e.id, entryType: "reversal", account: "reversals", token: e.token, amount: `-${e.amount}`, usdValue: e.usd_value === null ? null : -Number(e.usd_value), memo: `${e.status}: ${e.tx_hash}` }]);
    await alert("warning", "ledger_reversal", `Ledger entry for ${e.tx_hash.slice(0, 12)}… reversed (${e.status}).`);
  }
  void s; void getChain;
}
