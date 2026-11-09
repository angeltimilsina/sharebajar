"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import { Buffer } from "buffer";
import { CheckCircle2, ExternalLink, Loader2, Rocket, ShieldCheck } from "lucide-react";
import { useWallet } from "../wallet/WalletProvider";
import { Badge, Button, Notice } from "../ui/primitives";
import { buildLaunchTransaction, validateLaunch, METADATA_SIZE, MINT_SIZE, TOKEN_ACCOUNT_SIZE } from "@/lib/launch/solanaToken";
import { addActivity } from "@/lib/activity";

const input = "w-full h-11 rounded-xl border border-line bg-surface-2 px-3 text-[15px] sm:text-sm outline-none focus:border-line-strong";
type Config = { fee: { amountUsdc: number; recipient: string } | null; metadataHosting: boolean };
type Step = "form" | "review" | "signing" | "sending" | "done" | "failed";

async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  const r = await fetch("/api/wallet/rpc", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chain: "solana", method, params }) });
  const b = await r.json();
  if (b.error) throw new Error(b.error.message);
  return b.result as T;
}

/**
 * Launch an SPL token on Solana from your own wallet. Built and simulated in
 * the browser; you sign once. Bajar keeps no authority over the token.
 */
export function TokenLauncher({ onManage }: { onManage?: (mint: string) => void } = {}) {
  const { wallet, openModal, solana } = useWallet();
  const [cfg, setCfg] = useState<Config | null>(null);
  const [f, setF] = useState({ name: "", symbol: "", supply: "1000000000", decimals: "6", description: "", image: "", website: "", twitter: "", telegram: "", uri: "" });
  const [opts, setOpts] = useState({ revokeMint: true, revokeFreeze: true, immutable: false });
  const [costs, setCosts] = useState<{ rentSol: number; feeSol: number } | null>(null);
  const [step, setStep] = useState<Step>("form");
  const [sim, setSim] = useState<{ ok: boolean; units?: number; error?: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<{ mint: string; signature: string } | null>(null);
  const [uri, setUri] = useState<string>("");
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF((s) => ({ ...s, [k]: e.target.value }));

  useEffect(() => { fetch("/api/launch/config").then((r) => r.json()).then(setCfg).catch(() => setCfg({ fee: null, metadataHosting: false })); }, []);
  useEffect(() => {
    Promise.all([MINT_SIZE, TOKEN_ACCOUNT_SIZE, METADATA_SIZE].map((n) => rpc<number>("getMinimumBalanceForRentExemption", [n])))
      .then((r) => setCosts({ rentSol: r.reduce((a, b) => a + b, 0) / 1e9, feeSol: 0.00001 + (160_000 * 50_000) / 1e15 }))
      .catch(() => setCosts(null));
  }, []);

  const supply = /^\d{1,20}$/.test(f.supply) ? BigInt(f.supply) : BigInt(0);
  const decimals = Number(f.decimals);
  const formErr = validateLaunch({ name: f.name, symbol: f.symbol, uri: f.uri, decimals, supply });

  const prepareMetadata = async (): Promise<string> => {
    if (f.uri) return f.uri;
    if (!f.image && !f.description && !f.website && !f.twitter && !f.telegram) return "";
    const r = await fetch("/api/launch/metadata", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: f.name, symbol: f.symbol, description: f.description, image: f.image || undefined, website: f.website || undefined, twitter: f.twitter || undefined, telegram: f.telegram || undefined }) });
    const b = await r.json();
    if (!r.ok) throw new Error(b.error ?? "Couldn't host metadata");
    return b.uri;
  };

  const build = async (payer: string, metaUri: string) => {
    const [{ value: { blockhash } }, rentMint] = await Promise.all([rpc<{ value: { blockhash: string } }>("getLatestBlockhash", [{ commitment: "confirmed" }]), rpc<number>("getMinimumBalanceForRentExemption", [MINT_SIZE])]);
    return buildLaunchTransaction({
      payer, name: f.name, symbol: f.symbol, uri: metaUri, decimals, supply, ...opts,
      launchFee: cfg?.fee ? { amountRaw: BigInt(Math.round(cfg.fee.amountUsdc * 1e6)), recipientOwner: cfg.fee.recipient } : null,
    }, { blockhash, rent: { mint: rentMint } });
  };

  const review = async () => {
    setErr(null); setSim(null);
    if (!wallet || wallet.chainType !== "solana") { openModal(); return; }
    try {
      const metaUri = await prepareMetadata();
      setUri(metaUri);
      const { tx } = await build(wallet.address, metaUri);
      const b64 = Buffer.from(tx.serialize({ requireAllSignatures: false, verifySignatures: false })).toString("base64");
      const s = await rpc<{ value: { err: unknown; unitsConsumed?: number; logs?: string[] } }>("simulateTransaction", [b64, { encoding: "base64", sigVerify: false, replaceRecentBlockhash: true, commitment: "confirmed" }]);
      setSim(s.value.err ? { ok: false, error: /insufficient|0x1\b/i.test(JSON.stringify(s.value.logs ?? s.value.err)) ? "Not enough SOL (or USDC for the launch fee) in this wallet." : JSON.stringify(s.value.err) } : { ok: true, units: s.value.unitsConsumed });
      setStep("review");
    } catch (e) { setErr((e as Error).message); }
  };

  const launch = async () => {
    const p = solana();
    if (!p?.signTransaction || !wallet) { setErr("This wallet can't sign transactions."); return; }
    setErr(null); setStep("signing");
    try {
      const { tx, mintAddress } = await build(wallet.address, uri); // fresh blockhash
      const signed = await p.signTransaction(tx);
      setStep("sending");
      const signature = await rpc<string>("sendTransaction", [Buffer.from(signed.serialize()).toString("base64"), { encoding: "base64", preflightCommitment: "confirmed", maxRetries: 3 }]);
      addActivity({ chain: "solana", hash: signature, kind: "send", summary: `Launched ${f.symbol} (${f.name})`, wallet: wallet.address, assetHref: `/token/solana/${mintAddress}` });
      for (let i = 0; i < 45; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        const st = await rpc<{ value: ({ err: unknown; confirmationStatus: string } | null)[] }>("getSignatureStatuses", [[signature], { searchTransactionHistory: true }]).catch(() => null);
        const v = st?.value[0];
        if (v?.err) throw new Error(`Transaction failed on-chain: ${JSON.stringify(v.err)}`);
        if (v && (v.confirmationStatus === "confirmed" || v.confirmationStatus === "finalized")) break;
      }
      fetch("/api/launch/record", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ signature, mint: mintAddress }) }).catch(() => {});
      setResult({ mint: mintAddress, signature });
      setStep("done");
    } catch (e) {
      const m = (e as Error).message;
      setErr(/reject|denied|cancel/i.test(m) ? "You rejected the transaction. Nothing was created." : m);
      setStep("failed");
    }
  };

  if (step === "done" && result) {
    return (
      <div className="space-y-4" data-testid="launch-done">
        <div className="text-center">
          <CheckCircle2 className="mx-auto text-accent" size={36} />
          <h3 className="mt-2 text-xl">{f.symbol} is live on Solana</h3>
          <p className="text-xs text-muted font-mono break-all mt-1">{result.mint}</p>
        </div>
        <ol className="space-y-2 text-sm">
          <li className="rounded-xl bg-surface-2 p-3"><b>1. Add liquidity</b> so people can trade it — create a pool on <a className="underline" href="https://raydium.io/liquidity/create-pool/" target="_blank" rel="noopener noreferrer">Raydium</a>, <a className="underline" href="https://app.meteora.ag/pools/create" target="_blank" rel="noopener noreferrer">Meteora</a> or <a className="underline" href="https://www.orca.so/pools" target="_blank" rel="noopener noreferrer">Orca</a> using your {f.symbol} and SOL/USDC.</li>
          <li className="rounded-xl bg-surface-2 p-3"><b>2. Share the token page</b> — once a pool exists, its live chart, risk check and trading appear on Bajar.</li>
          <li className="rounded-xl bg-surface-2 p-3"><b>3. Keep your wallet safe</b> — it holds the full supply{opts.revokeMint ? "" : " and the mint authority"}.</li>
        </ol>
        <div className="flex flex-wrap gap-2">
          {onManage && <Button onClick={() => onManage(result.mint)}>Manage token</Button>}
          <Link href={`/token/solana/${result.mint}`}><Button variant="outline">Open token page</Button></Link>
          <a href={`https://solscan.io/tx/${result.signature}`} target="_blank" rel="noopener noreferrer"><Button variant="outline">View transaction <ExternalLink size={13} /></Button></a>
          <Link href="/portfolio"><Button variant="ghost">Portfolio</Button></Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-xs"><img src="/logos/networks/solana.svg" alt="" width={16} height={16} /> <span className="font-medium">Solana</span><span className="text-muted">· SPL token + Metaplex metadata</span></div>
      <fieldset disabled={step !== "form"} className="space-y-2.5">
        <div className="grid grid-cols-[1fr_120px] gap-2">
          <input className={input} placeholder="Token name" maxLength={32} value={f.name} onChange={set("name")} aria-label="Token name" />
          <input className={input} placeholder="Symbol" maxLength={10} value={f.symbol} onChange={(e) => setF((s) => ({ ...s, symbol: e.target.value.toUpperCase().replace(/[^A-Z0-9$._-]/g, "") }))} aria-label="Symbol" />
        </div>
        <div className="grid grid-cols-[1fr_120px] gap-2">
          <input className={input} inputMode="numeric" placeholder="Total supply" value={f.supply} onChange={(e) => setF((s) => ({ ...s, supply: e.target.value.replace(/\D/g, "") }))} aria-label="Total supply" />
          <select className={input} value={f.decimals} onChange={(e) => setF((s) => ({ ...s, decimals: e.target.value }))} aria-label="Decimals">{[0, 2, 4, 6, 8, 9].map((d) => <option key={d} value={d}>{d} decimals</option>)}</select>
        </div>
        <textarea className={clsx(input, "h-20 py-2")} maxLength={1000} placeholder="Description (optional)" value={f.description} onChange={set("description")} aria-label="Description" />
        <input className={input} placeholder="Logo image URL — https://… (optional)" value={f.image} onChange={set("image")} aria-label="Logo image URL" />
        <div className="grid sm:grid-cols-3 gap-2">
          <input className={input} placeholder="Website" value={f.website} onChange={set("website")} aria-label="Website" />
          <input className={input} placeholder="X / Twitter URL" value={f.twitter} onChange={set("twitter")} aria-label="Twitter" />
          <input className={input} placeholder="Telegram URL" value={f.telegram} onChange={set("telegram")} aria-label="Telegram" />
        </div>
        <div className="rounded-xl border border-line divide-y divide-line text-sm">
          {([["revokeMint", "Fixed supply", "Revoke mint authority — no one can ever mint more. Strongly preferred by buyers."], ["revokeFreeze", "No freeze authority", "No one can freeze holders' tokens. Required by most DEXs and screeners."], ["immutable", "Lock metadata", "Name, symbol and image can never be changed."]] as const).map(([k, label, hint]) => (
            <label key={k} className="flex items-start gap-3 px-3 py-2.5 cursor-pointer">
              <input type="checkbox" className="mt-1" checked={opts[k]} onChange={(e) => setOpts((o) => ({ ...o, [k]: e.target.checked }))} />
              <span><span className="block font-medium">{label}</span><span className="block text-xs text-muted">{hint}</span></span>
            </label>
          ))}
        </div>
        <details className="text-xs"><summary className="cursor-pointer text-muted">Advanced: use my own metadata URI (IPFS / Arweave)</summary>
          <input className={clsx(input, "mt-2")} placeholder="ipfs://… or https://… JSON" value={f.uri} onChange={set("uri")} aria-label="Metadata URI" />
          {cfg && !cfg.metadataHosting && <p className="mt-1 text-warn">Metadata hosting isn&apos;t available on this deployment — provide a URI to show a logo and links.</p>}
        </details>
      </fieldset>

      <div className="rounded-xl bg-surface-2 p-3 text-xs space-y-1" data-testid="launch-costs">
        <div className="flex justify-between"><span className="text-muted">Network rent (mint, token account, metadata)</span><span className="num">{costs ? `≈ ${costs.rentSol.toFixed(4)} SOL` : "…"}</span></div>
        <div className="flex justify-between"><span className="text-muted">Network fee</span><span className="num">{costs ? `≈ ${costs.feeSol.toFixed(5)} SOL` : "…"}</span></div>
        <div className="flex justify-between"><span className="text-muted">Bajar launch fee</span><span className="num">{cfg ? (cfg.fee ? `${cfg.fee.amountUsdc} USDC` : "None") : "…"}</span></div>
        <p className="text-faint pt-1">Rent is held by the accounts (not paid to Bajar). The full supply is minted to your wallet.</p>
      </div>

      {formErr && (f.name || f.symbol) && <p className="text-xs text-down">{formErr}</p>}
      {err && <Notice tone="down">{err}</Notice>}
      {step === "review" && sim && (
        <Notice tone={sim.ok ? "info" : "down"} title={sim.ok ? "Simulation passed" : "Simulation failed"}>
          {sim.ok ? <>All instructions executed successfully in simulation ({sim.units?.toLocaleString()} compute units). Your wallet will ask you to approve one transaction.</> : sim.error}
        </Notice>
      )}

      {step === "form" && (
        !wallet || wallet.chainType !== "solana"
          ? <Button className="w-full h-11" disabled={!!formErr} onClick={openModal} data-testid="launch-connect">Connect a Solana wallet to launch</Button>
          : <Button className="w-full h-11" disabled={!!formErr} onClick={review}><Rocket size={15} /> Review launch</Button>
      )}
      {step === "review" && (
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setStep("form")}>Edit</Button>
          <Button className="flex-1 h-11" disabled={!sim?.ok} onClick={launch}><Rocket size={15} /> Launch {f.symbol}</Button>
        </div>
      )}
      {(step === "signing" || step === "sending") && <Button className="w-full h-11" disabled><Loader2 size={15} className="animate-spin" /> {step === "signing" ? "Approve in your wallet…" : "Confirming on Solana…"}</Button>}
      {step === "failed" && <Button className="w-full h-11" variant="outline" onClick={() => setStep("form")}>Back</Button>}
      <p className="text-[11px] text-faint flex gap-1.5"><ShieldCheck size={13} className="shrink-0 text-accent" /> Built and simulated in your browser, signed by your wallet. Bajar never holds keys or authority over your token. Launching a token can carry legal obligations where you live.</p>
    </div>
  );
}
