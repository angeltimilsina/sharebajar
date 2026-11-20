"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import { CheckCircle2, ExternalLink, Loader2, Rocket, ShieldCheck } from "lucide-react";
import { useWallet } from "../wallet/WalletProvider";
import { Badge, Button, Notice } from "../ui/primitives";
import { buildLaunchTransaction, computeLimitFrom, confirmSignature, explainSimulation, networkFeeSol, sendSigned, simulate, solRpc as rpc, validateLaunch, METADATA_SIZE, METAPLEX_CREATE_FEE_LAMPORTS, MINT_SIZE, SIM_COMPUTE_UNITS, TOKEN_ACCOUNT_SIZE, ATA_PROGRAM, TOKEN_PROGRAM, USDC_MINT } from "@/lib/launch/solanaToken";
import { LINK_WALLETS, linkWalletOf } from "@/lib/wallet/solanaLink";
import { addActivity } from "@/lib/activity";

const input = "w-full h-11 rounded-xl border border-line bg-surface-2 px-3 text-[15px] sm:text-sm outline-none focus:border-line-strong";
type Config = { fee: { amountUsdc: number; recipient: string } | null; metadataHosting: boolean };
type Step = "form" | "review" | "signing" | "sending" | "done" | "failed";

type Fee = { amountRaw: bigint; recipientOwner: string } | null;

/** Deep-link (mobile app) wallets can't sign in-page, and the launch needs a locally generated mint key co-signing. */
function linkWalletBlock(walletId: string | undefined): { message: string; openUrl: string | null } | null {
  const lw = linkWalletOf(walletId);
  if (!lw) return null;
  const name = LINK_WALLETS[lw].name;
  const here = typeof window !== "undefined" ? window.location.href : "";
  const browse: Record<string, string> = { phantom: "https://phantom.app/ul/browse/", solflare: "https://solflare.com/ul/v1/browse/", backpack: "https://backpack.app/ul/v1/browse/" };
  return {
    message: `Launching a token needs ${name}'s in-app browser: the launch is co-signed by a one-time mint key created on this page, which a ${name} app link can't carry. Open Bajar inside the ${name} app to launch.`,
    openUrl: here ? `${browse[lw]}${encodeURIComponent(here)}?ref=${encodeURIComponent(new URL(here).origin)}` : null,
  };
}

/**
 * Launch an SPL token on Solana from your own wallet. Built and simulated in
 * the browser; you sign once. Bajar keeps no authority over the token.
 */
export interface LaunchPreset { name: string; symbol: string; supply: string; decimals: string; description: string; image: string; website: string; twitter: string; telegram: string; revokeMint: boolean; revokeFreeze: boolean; immutable: boolean }

/**
 * With `preset` (from the multi-network launch wizard) the details are fixed
 * and the form is hidden; `fee` overrides the single-network fee; the launch
 * is recorded in the same group (`groupKey`) and `onLaunched` fires when live.
 */
export function TokenLauncher({ onManage, preset, fee: feeOverride, groupKey, onLaunched }: { onManage?: (mint: string) => void; preset?: LaunchPreset; fee?: { amountUsdc: number; recipient: string } | null; groupKey?: string; onLaunched?: (mint: string) => void } = {}) {
  const { wallet, openModal, solana } = useWallet();
  const [cfg, setCfg] = useState<Config | null>(null);
  const [f, setF] = useState(() => preset ? { name: preset.name, symbol: preset.symbol, supply: preset.supply, decimals: preset.decimals, description: preset.description, image: preset.image, website: preset.website, twitter: preset.twitter, telegram: preset.telegram, uri: "" } : { name: "", symbol: "", supply: "1000000000", decimals: "6", description: "", image: "", website: "", twitter: "", telegram: "", uri: "" });
  const [opts, setOpts] = useState(() => preset ? { revokeMint: preset.revokeMint, revokeFreeze: preset.revokeFreeze, immutable: preset.immutable } : { revokeMint: true, revokeFreeze: true, immutable: false });
  const [costs, setCosts] = useState<{ rentSol: number; metaplexSol: number; feeSol: number } | null>(null);
  const [step, setStep] = useState<Step>("form");
  const [sim, setSim] = useState<{ ok: boolean; units?: number; error?: string } | null>(null);
  // What the review simulated and showed; launch() signs exactly this (fee included).
  const [reviewed, setReviewed] = useState<{ fee: Fee; units?: number } | null>(null);
  const [metaCache, setMetaCache] = useState<{ key: string; uri: string; note: string | null } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<{ mint: string; signature: string } | null>(null);
  const [uri, setUri] = useState<string>("");
  const [metaNote, setMetaNote] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF((s) => ({ ...s, [k]: e.target.value }));

  useEffect(() => { fetch("/api/launch/config").then((r) => r.json()).then(setCfg).catch(() => setCfg({ fee: null, metadataHosting: false })); }, []);
  useEffect(() => {
    Promise.all([MINT_SIZE, TOKEN_ACCOUNT_SIZE, METADATA_SIZE].map((n) => rpc<number>("getMinimumBalanceForRentExemption", [n])))
      .then((r) => setCosts({ rentSol: r.reduce((a, b) => a + b, 0) / 1e9, metaplexSol: METAPLEX_CREATE_FEE_LAMPORTS / 1e9, feeSol: networkFeeSol(2, computeLimitFrom(90_000)) }))
      .catch(() => setCosts(null));
  }, []);

  const supply = /^\d{1,20}$/.test(f.supply) ? BigInt(f.supply) : BigInt(0);
  const decimals = Number(f.decimals);
  const formErr = validateLaunch({ name: f.name, symbol: f.symbol, uri: f.uri, decimals, supply });

  const linkBlock = wallet?.chainType === "solana" ? linkWalletBlock(wallet.walletId) : null;

  const prepareMetadata = async (): Promise<string> => {
    if (f.uri) { setMetaNote(null); return f.uri.trim(); }
    if (!f.image && !f.description && !f.website && !f.twitter && !f.telegram) { setMetaNote(null); return ""; }
    const body = { name: f.name.trim(), symbol: f.symbol, description: f.description, image: f.image.trim() || undefined, website: f.website.trim() || undefined, twitter: f.twitter.trim() || undefined, telegram: f.telegram.trim() || undefined };
    const key = JSON.stringify(body);
    if (metaCache?.key === key) { setMetaNote(metaCache.note); return metaCache.uri; } // don't re-host on every review (rate-limited)
    const r = await fetch("/api/launch/metadata", { method: "POST", headers: { "content-type": "application/json" }, body: key });
    const b = await r.json().catch(() => null) as { uri?: unknown; dropped?: unknown; mode?: string; error?: string } | null;
    if (!r.ok || !b) throw new Error(b?.error ?? (r.status === 429 ? "Too many metadata requests. Wait a minute and try again." : "Couldn't host metadata. Try again, or use your own metadata URI under Advanced."));
    const hosted = typeof b.uri === "string" ? b.uri : "";
    // Metaplex stores at most 200 bytes; the in-URL mode (no database) is sized to fit, but never trust it blindly.
    if (!hosted || new TextEncoder().encode(hosted).length > 200) throw new Error("The hosted metadata link is longer than Metaplex's 200-byte limit. Use a shorter logo URL, or your own metadata URI under Advanced.");
    const dropped = Array.isArray(b.dropped) ? b.dropped.filter((x): x is string => typeof x === "string") : [];
    const note = dropped.length ? `Saved without ${dropped.join(", ")} to fit the 200-byte limit. Add them later with Edit metadata, or use your own metadata URI.` : null;
    setMetaNote(note);
    setMetaCache({ key, uri: hosted, note });
    return hosted;
  };

  const shownFee = feeOverride !== undefined ? feeOverride : cfg?.fee ?? null;
  const feeFromCfg = (): Fee => shownFee ? { amountRaw: BigInt(Math.round(shownFee.amountUsdc * 1e6)), recipientOwner: shownFee.recipient } : null;

  const build = async (payer: string, metaUri: string, fee: Fee, computeUnits?: number) => {
    const [{ value: { blockhash, lastValidBlockHeight } }, rentMint] = await Promise.all([rpc<{ value: { blockhash: string; lastValidBlockHeight: number } }>("getLatestBlockhash", [{ commitment: "confirmed" }]), rpc<number>("getMinimumBalanceForRentExemption", [MINT_SIZE])]);
    const built = await buildLaunchTransaction({ payer, name: f.name, symbol: f.symbol, uri: metaUri, decimals, supply, ...opts, launchFee: fee }, { blockhash, rent: { mint: rentMint }, computeUnits });
    return { ...built, lastValidBlockHeight };
  };

  /** Human message for a failed simulation, with balances when it's about money. */
  const explain = async (payer: string, s: { err: unknown; logs?: string[] | null }, fee: Fee) => {
    const msg = explainSimulation(s, "launch");
    if (/SOL/.test(msg) && costs) {
      const bal = await rpc<{ value: number }>("getBalance", [payer, { commitment: "confirmed" }]).catch(() => null);
      if (bal) return `${msg} You have ${(bal.value / 1e9).toFixed(4)} SOL; launching needs about ${(costs.rentSol + costs.metaplexSol + networkFeeSol(2, computeLimitFrom(90_000)) + (fee ? 0.0015 : 0)).toFixed(4)} SOL.`;
    }
    return msg;
  };

  /** Launch fee check up front: a missing USDC account otherwise fails as "invalid account data". */
  const checkUsdc = async (payer: string, fee: Fee) => {
    if (!fee) return;
    const { PublicKey } = await import("@solana/web3.js");
    const ata = PublicKey.findProgramAddressSync([new PublicKey(payer).toBuffer(), new PublicKey(TOKEN_PROGRAM).toBuffer(), new PublicKey(USDC_MINT).toBuffer()], new PublicKey(ATA_PROGRAM))[0];
    const a = await rpc<{ value: { data: { parsed?: { info: { tokenAmount: { amount: string } } } } } | null }>("getAccountInfo", [ata.toBase58(), { encoding: "jsonParsed", commitment: "confirmed" }]);
    const have = BigInt(a.value?.data?.parsed?.info.tokenAmount.amount ?? "0");
    if (have < fee.amountRaw) throw new Error(`The launch fee is ${Number(fee.amountRaw) / 1e6} USDC, but this wallet holds ${(Number(have) / 1e6).toLocaleString(undefined, { maximumFractionDigits: 6 })} USDC. Add USDC and try again.`);
  };

  const review = async () => {
    setErr(null); setSim(null); setReviewed(null);
    if (!wallet || wallet.chainType !== "solana") { openModal(); return; }
    if (linkBlock) { setErr(linkBlock.message); return; }
    if (!cfg) { setErr("Still loading launch settings. Try again in a moment."); return; }
    try {
      const fee = feeFromCfg();
      const metaUri = await prepareMetadata();
      setUri(metaUri);
      await checkUsdc(wallet.address, fee);
      const { tx } = await build(wallet.address, metaUri, fee, SIM_COMPUTE_UNITS);
      const s = await simulate(tx);
      if (s.err) setSim({ ok: false, error: await explain(wallet.address, s, fee) });
      else { setSim({ ok: true, units: s.unitsConsumed }); setReviewed({ fee, units: s.unitsConsumed }); }
      setStep("review");
    } catch (e) { setErr((e as Error).message); }
  };

  const launch = async () => {
    if (!wallet || !reviewed) return;
    if (linkBlock) { setErr(linkBlock.message); return; }
    const p = solana();
    if (!p?.signTransaction) { setErr("This wallet can't sign transactions. Connect Phantom, Solflare or Backpack in this browser."); return; }
    setErr(null); setStep("signing");
    try {
      // Fresh blockhash and mint key: re-simulate exactly what will be signed, with a compute limit sized from the review.
      const { tx, mintAddress, lastValidBlockHeight } = await build(wallet.address, uri, reviewed.fee, computeLimitFrom(reviewed.units));
      const s = await simulate(tx);
      if (s.err) throw new Error(await explain(wallet.address, s, reviewed.fee));
      const signed = await p.signTransaction(tx);
      setStep("sending");
      const signature = await sendSigned(signed);
      addActivity({ chain: "solana", hash: signature, kind: "send", summary: `Launched ${f.symbol} (${f.name})`, wallet: wallet.address, assetHref: `/token/solana/${mintAddress}` });
      await confirmSignature(signature, lastValidBlockHeight);
      // Record it for your token list. The server verifies the transaction on-chain, which can take
      // a few seconds to be indexed after confirmation: retry on 404/429/5xx.
      void (async () => {
        for (let i = 0; i < 8; i++) {
          if (i) await new Promise((res) => setTimeout(res, 2500 * i));
          const r = await fetch("/api/launch/record", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ signature, mint: mintAddress, ...(groupKey ? { groupKey } : {}) }) }).catch(() => null);
          if (r?.ok || (r && r.status !== 404 && r.status !== 429 && r.status < 500)) return;
        }
      })();
      setResult({ mint: mintAddress, signature });
      setStep("done");
      void import("@/lib/launch/mine").then((m) => m.trackInBajarWallet({ mint: mintAddress, chain: "solana", symbol: f.symbol, decimals, creator: wallet.address }));
      onLaunched?.(mintAddress);
    } catch (e) {
      const m = (e as Error).message;
      setErr(/reject|denied|cancel|declined/i.test(m) && !/expired/i.test(m) ? "You rejected the transaction. Nothing was created." : m);
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
      {preset && <div className="rounded-xl bg-surface-2 px-3 py-2 text-[13px]"><b>{f.symbol}</b> · {f.name} · {Number(f.supply).toLocaleString()} supply · {f.decimals} decimals{opts.revokeMint ? " · fixed supply" : ""}{opts.revokeFreeze ? " · no freeze" : ""}{opts.immutable ? " · metadata locked" : ""}</div>}
      <fieldset disabled={step !== "form"} className={clsx("space-y-2.5", preset && "hidden")}>
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
        </details>
      </fieldset>

      <div className="rounded-xl bg-surface-2 p-3 text-xs space-y-1" data-testid="launch-costs">
        <div className="flex justify-between"><span className="text-muted">Network rent (mint, token account, metadata)</span><span className="num">{costs ? `≈ ${costs.rentSol.toFixed(4)} SOL` : "…"}</span></div>
        <div className="flex justify-between"><span className="text-muted">Metaplex metadata fee (protocol)</span><span className="num">{costs ? `${costs.metaplexSol.toFixed(2)} SOL` : "…"}</span></div>
        <div className="flex justify-between"><span className="text-muted">Network fee</span><span className="num">{costs ? `≈ ${costs.feeSol.toFixed(5)} SOL` : "…"}</span></div>
        <div className="flex justify-between"><span className="text-muted">Bajar launch fee</span><span className="num">{cfg ? (shownFee ? `${shownFee.amountUsdc} USDC` : "None") : "…"}</span></div>
        <p className="text-faint pt-1">Rent is held by the accounts and the metadata fee goes to Metaplex (neither is paid to Bajar). The full supply is minted to your wallet.</p>
      </div>

      {formErr && (f.name || f.symbol) && <p className="text-xs text-down">{formErr}</p>}
      {err && <Notice tone="down">{err}{linkBlock?.openUrl && err === linkBlock.message && <> <a className="underline" href={linkBlock.openUrl}>Open in {LINK_WALLETS[linkWalletOf(wallet?.walletId)!].name}</a></>}</Notice>}
      {metaNote && step === "review" && <Notice tone="warn">{metaNote}</Notice>}
      {step === "review" && sim && (
        <Notice tone={sim.ok ? "info" : "down"} title={sim.ok ? "Simulation passed" : "Simulation failed"}>
          {sim.ok ? <>All instructions executed successfully in simulation ({sim.units?.toLocaleString()} compute units). Your wallet will ask you to approve one transaction.</> : sim.error}
        </Notice>
      )}

      {step === "form" && (
        !wallet || wallet.chainType !== "solana"
          ? <Button className="w-full h-11" disabled={!!formErr} onClick={openModal} data-testid="launch-connect">Connect a Solana wallet to launch</Button>
          : <Button className="w-full h-11" disabled={!!formErr || !cfg} onClick={review}><Rocket size={15} /> Review launch</Button>
      )}
      {step === "review" && (
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setStep("form")}>Edit</Button>
          <Button className="flex-1 h-11" disabled={!sim?.ok || !reviewed} onClick={launch}><Rocket size={15} /> Launch {f.symbol}</Button>
        </div>
      )}
      {(step === "signing" || step === "sending") && <Button className="w-full h-11" disabled><Loader2 size={15} className="animate-spin" /> {step === "signing" ? "Approve in your wallet…" : "Confirming on Solana…"}</Button>}
      {step === "failed" && <Button className="w-full h-11" variant="outline" onClick={() => setStep("form")}>Back</Button>}
      <p className="text-[11px] text-faint flex gap-1.5"><ShieldCheck size={13} className="shrink-0 text-accent" /> Built and simulated in your browser, signed by your wallet. Bajar never holds keys or authority over your token. Launching a token can carry legal obligations where you live.</p>
    </div>
  );
}
