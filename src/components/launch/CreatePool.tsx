"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Buffer } from "buffer";
import { CheckCircle2, Droplets, ExternalLink, Loader2 } from "lucide-react";
import { formatUnits, parseEther, parseUnits } from "viem";
import { useWallet } from "../wallet/WalletProvider";
import { Button, Notice } from "../ui/primitives";
import { buildCreatePool, createFeeFromConfig, CPMM_CONFIG } from "@/lib/launch/raydiumCpmm";
import { addLiquidityEthData, approveData, balanceOfData, V2_ROUTERS } from "@/lib/launch/evmPool";
import { EVM_LAUNCH_CHAINS, ensureChain, isUserRejection, waitReceipt, walletErrorMessage } from "@/lib/launch/evmToken";
import { addActivity } from "@/lib/activity";

const NATIVE: Record<string, string> = { solana: "SOL", ethereum: "ETH", base: "ETH", bsc: "BNB" };
const BINANCE: Record<string, string> = { solana: "SOLUSDT", ethereum: "ETHUSDT", base: "ETHUSDT", bsc: "BNBUSDT" };

async function sol<T>(method: string, params: unknown[]): Promise<T> {
  const r = await fetch("/api/wallet/rpc", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chain: "solana", method, params }) });
  const b = await r.json();
  if (b.error) throw new Error(b.error.message ?? "RPC error");
  return b.result as T;
}

/**
 * Create the first trading pool for a token you hold: Raydium CPMM on Solana,
 * Uniswap V2 on Ethereum/Base, PancakeSwap V2 on BNB Chain. You choose how
 * many tokens and how much SOL/ETH/BNB to deposit (that sets the starting
 * price); everything is simulated and signed in your wallet. LP tokens go to
 * you. Once the pool exists, DEX screeners and Bajar's market pick it up.
 */
export function CreatePool({ chain, token, symbol, decimals, onCreated }: { chain: string; token: string; symbol: string; decimals: number; onCreated?: (pool: string) => void }) {
  const { wallet, openModal, solana, evm } = useWallet();
  const [bal, setBal] = useState<bigint | null>(null);
  const [pct, setPct] = useState(50);
  const [quote, setQuote] = useState("");
  const [nativeUsd, setNativeUsd] = useState<number | null>(null);
  const [raydiumFee, setRaydiumFee] = useState<bigint | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<{ pool: string; tx: string } | null>(null);
  const needsSol = chain === "solana";
  const rightWallet = !!wallet && (needsSol ? wallet.chainType === "solana" : wallet.chainType === "evm");
  const evmChain = EVM_LAUNCH_CHAINS.find((c) => c.id === chain);

  useEffect(() => {
    fetch(`/api/candles?symbol=${BINANCE[chain]}&res=1m`).then((r) => r.json()).then((b) => { const d = b.data ?? []; setNativeUsd(d.length ? d[d.length - 1].close : null); }).catch(() => {});
    if (needsSol) sol<{ value: { data: [string, string] } | null }>("getAccountInfo", [CPMM_CONFIG, { encoding: "base64" }]).then((r) => { if (r.value) setRaydiumFee(createFeeFromConfig(Buffer.from(r.value.data[0], "base64"))); }).catch(() => {});
  }, [chain, needsSol]);

  // Your token balance (what you can deposit).
  useEffect(() => {
    setBal(null);
    if (!wallet || !rightWallet) return;
    (async () => {
      try {
        if (needsSol) {
          const { PublicKey } = await import("@solana/web3.js");
          const ata = PublicKey.findProgramAddressSync([new PublicKey(wallet.address).toBuffer(), new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA").toBuffer(), new PublicKey(token).toBuffer()], new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"))[0];
          const a = await sol<{ value: { data: { parsed?: { info: { tokenAmount: { amount: string } } } } } | null }>("getAccountInfo", [ata.toBase58(), { encoding: "jsonParsed" }]);
          setBal(BigInt(a.value?.data?.parsed?.info.tokenAmount.amount ?? "0"));
        } else {
          const p = evm();
          if (!p || !evmChain) return;
          await ensureChain(p, evmChain.chainId);
          setBal(BigInt(await p.request({ method: "eth_call", params: [{ to: token, data: balanceOfData(wallet.address as `0x${string}`) }, "latest"] }) as string));
        }
      } catch { setBal(BigInt(0)); }
    })();
  }, [wallet?.address, rightWallet, token, needsSol]); // eslint-disable-line react-hooks/exhaustive-deps

  const tokenAmount = bal !== null ? (bal * BigInt(pct)) / BigInt(100) : BigInt(0);
  let quoteRaw = BigInt(0);
  try { quoteRaw = quote ? (needsSol ? parseUnits(quote, 9) : parseEther(quote)) : BigInt(0); } catch { quoteRaw = BigInt(0); }
  const tokensUi = Number(formatUnits(tokenAmount, decimals));
  const quoteUi = Number(quote || 0);
  const priceNative = tokensUi > 0 && quoteUi > 0 ? quoteUi / tokensUi : null;
  const priceUsd = priceNative !== null && nativeUsd ? priceNative * nativeUsd : null;
  const ready = rightWallet && tokenAmount > BigInt(0) && quoteRaw > BigInt(0);

  const createSolana = async () => {
    const p = solana();
    if (!wallet || !p?.signTransaction) throw new Error("This wallet can't sign transactions here.");
    const { value: { blockhash } } = await sol<{ value: { blockhash: string } }>("getLatestBlockhash", [{ commitment: "confirmed" }]);
    const { tx, pool } = await buildCreatePool(wallet.address, { mint: token, tokenAmountRaw: tokenAmount, solLamports: quoteRaw }, blockhash);
    setBusy("Simulating…");
    const sim = await sol<{ value: { err: unknown; logs?: string[] } }>("simulateTransaction", [Buffer.from(tx.serialize({ requireAllSignatures: false, verifySignatures: false })).toString("base64"), { encoding: "base64", sigVerify: false, replaceRecentBlockhash: true, commitment: "confirmed" }]);
    if (sim.value.err) {
      const logs = (sim.value.logs ?? []).join(" ");
      throw new Error(/insufficient lamports|0x1\b/i.test(logs) ? `Not enough SOL: you need the ${quote} SOL deposit plus Raydium's ${raydiumFee ? Number(raydiumFee) / 1e9 : 0.15} SOL pool fee and about 0.03 SOL for accounts.` : /already in use|custom program error: 0x0/i.test(logs) ? "A Raydium pool for this token and SOL already exists. Add liquidity to it from the Liquidity tab instead." : `Simulation failed: ${JSON.stringify(sim.value.err)}`);
    }
    setBusy("Approve in your wallet…");
    const signed = await p.signTransaction(tx);
    setBusy("Creating the pool…");
    const sig = await sol<string>("sendTransaction", [Buffer.from(signed.serialize()).toString("base64"), { encoding: "base64", preflightCommitment: "confirmed", maxRetries: 3 }]);
    for (let i = 0; i < 45; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      const st = await sol<{ value: ({ err: unknown; confirmationStatus: string } | null)[] }>("getSignatureStatuses", [[sig], { searchTransactionHistory: true }]).catch(() => null);
      const v = st?.value[0];
      if (v?.err) throw new Error("Pool creation failed on-chain.");
      if (v && (v.confirmationStatus === "confirmed" || v.confirmationStatus === "finalized")) break;
    }
    addActivity({ chain: "solana", hash: sig, kind: "send", summary: `Created ${symbol}/SOL pool on Raydium`, wallet: wallet.address, assetHref: `/token/solana/${token}` });
    return { pool, tx: sig };
  };

  const createEvm = async () => {
    const p = evm();
    const r = V2_ROUTERS[chain];
    if (!wallet || !p || !evmChain || !r) throw new Error("Connect an EVM wallet.");
    await ensureChain(p, evmChain.chainId);
    const from = wallet.address as `0x${string}`;
    setBusy("Approve the token for the DEX…");
    const ah = await p.request({ method: "eth_sendTransaction", params: [{ from, to: token, data: approveData(r.router, tokenAmount) }] }) as string;
    const arc = await waitReceipt(p, ah, chain);
    if (arc.status !== "0x1") throw new Error("Approval failed on-chain.");
    const data = addLiquidityEthData(token as `0x${string}`, tokenAmount, quoteRaw, from);
    setBusy("Simulating…");
    await p.request({ method: "eth_call", params: [{ from, to: r.router, data, value: `0x${quoteRaw.toString(16)}` }, "latest"] }).catch((e: unknown) => { throw new Error(`The deposit would fail: ${walletErrorMessage(e).slice(0, 160)}`); });
    setBusy("Approve the deposit in your wallet…");
    const h = await p.request({ method: "eth_sendTransaction", params: [{ from, to: r.router, data, value: `0x${quoteRaw.toString(16)}` }] }) as string;
    setBusy("Creating the pool…");
    const rc = await waitReceipt(p, h, chain);
    if (rc.status !== "0x1") throw new Error("Pool creation failed on-chain.");
    addActivity({ chain, hash: h, kind: "send", summary: `Created ${symbol}/${NATIVE[chain]} pool on ${r.dex}`, wallet: wallet.address, assetHref: `/token/${chain}/${token}` });
    return { pool: "", tx: h };
  };

  const create = async () => {
    setErr(null); setBusy("Preparing…");
    try {
      const res = needsSol ? await createSolana() : await createEvm();
      setDone(res); onCreated?.(res.pool);
    } catch (e) {
      setErr(isUserRejection(e) || /reject|denied|cancel/i.test(String((e as Error)?.message)) ? "You rejected it. No pool was created." : walletErrorMessage(e).slice(0, 260));
    } finally { setBusy(null); }
  };

  const explorer = needsSol ? `https://solscan.io/tx/${done?.tx}` : `${evmChain?.explorer}/tx/${done?.tx}`;
  if (done) {
    return (
      <div className="rounded-2xl bg-surface-2 p-3 space-y-2 text-[13.5px]" data-testid="pool-created">
        <div className="flex items-center gap-2 font-semibold"><CheckCircle2 size={16} className="text-up" /> {symbol} is tradable</div>
        <p className="text-muted text-[12.5px]">Your pool is live. DexScreener and GeckoTerminal usually list new pools within a few minutes; then {symbol}&apos;s price, chart and swaps appear on Bajar and in the Tokens market.</p>
        <div className="flex flex-wrap gap-2">
          <Link href={`/token/${chain}/${token}`}><Button size="sm">Token page</Button></Link>
          <a href={explorer} target="_blank" rel="noopener noreferrer"><Button size="sm" variant="outline">Transaction <ExternalLink size={12} /></Button></a>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-line p-3 space-y-2.5" data-testid="create-pool-form">
      <div className="flex items-center gap-2 text-[14px] font-semibold"><Droplets size={15} className="text-brand" /> Create a trading pool · {needsSol ? "Raydium" : V2_ROUTERS[chain]?.dex}</div>
      {!rightWallet ? (
        <Button className="w-full" variant="outline" onClick={openModal}>Connect your {needsSol ? "Solana" : "EVM"} wallet that holds {symbol}</Button>
      ) : (
        <>
          <div>
            <div className="flex justify-between text-[12px] text-muted"><span>{symbol} to deposit</span><span className="num">You hold {bal === null ? "…" : Number(formatUnits(bal, decimals)).toLocaleString()}</span></div>
            <div className="mt-1 grid grid-cols-4 gap-1">{[25, 50, 75, 100].map((v) => <button key={v} onClick={() => setPct(v)} className={`h-9 rounded-lg text-[13px] font-medium ${pct === v ? "bg-brand-fill text-brand-ink" : "bg-surface-2"}`}>{v}%</button>)}</div>
            <div className="mt-1 text-[12.5px] num">{tokensUi.toLocaleString()} {symbol}</div>
          </div>
          <label className="block text-[12px] text-muted">{NATIVE[chain]} to deposit
            <input value={quote} onChange={(e) => setQuote(e.target.value.replace(/[^\d.]/g, ""))} inputMode="decimal" placeholder={needsSol ? "e.g. 1" : "e.g. 0.1"} aria-label={`${NATIVE[chain]} amount`} className="no-ring mt-1 w-full h-10 rounded-lg bg-surface-2 px-3 text-[16px] sm:text-sm num outline-none" />
          </label>
          <dl className="grid grid-cols-2 gap-2 text-[12.5px]">
            <div className="rounded-lg bg-surface-2 px-2.5 py-1.5"><dt className="text-muted text-[11px]">Starting price</dt><dd className="num font-medium">{priceUsd !== null ? `$${priceUsd < 0.0001 ? priceUsd.toExponential(2) : priceUsd.toPrecision(3)}` : priceNative !== null ? `${priceNative.toExponential(2)} ${NATIVE[chain]}` : "—"}</dd></div>
            <div className="rounded-lg bg-surface-2 px-2.5 py-1.5"><dt className="text-muted text-[11px]">Pool value</dt><dd className="num font-medium">{nativeUsd && quoteUi ? `$${(quoteUi * nativeUsd * 2).toLocaleString(undefined, { maximumFractionDigits: 0 })}` : "—"}</dd></div>
          </dl>
          <p className="text-[11.5px] text-faint">{needsSol ? `Raydium charges ${raydiumFee ? Number(raydiumFee) / 1e9 : 0.15} SOL to create a pool, plus about 0.03 SOL for accounts. 0.25% fee tier.` : "Two approvals in your wallet: the token for the DEX router, then the deposit. Plus gas."} LP tokens go to your wallet; you can remove liquidity later on the DEX.</p>
          {err && <Notice tone="down">{err}</Notice>}
          <Button className="w-full" disabled={!ready || !!busy} onClick={create} data-testid="create-pool-submit">{busy ? <><Loader2 size={14} className="animate-spin" /> {busy}</> : `Create pool with ${quote || 0} ${NATIVE[chain]}`}</Button>
        </>
      )}
    </div>
  );
}
