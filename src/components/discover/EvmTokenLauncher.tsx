"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { CheckCircle2, ExternalLink, Loader2, Rocket, ShieldCheck } from "lucide-react";
import { formatEther } from "viem";
import { useWallet } from "../wallet/WalletProvider";
import { Button, Notice } from "../ui/primitives";
import { addActivity } from "@/lib/activity";
import { deployData, ensureChain, isUserRejection, quoteDeploy, validateEvmLaunch, waitReceipt, walletErrorMessage, type DeployQuote, type EvmLaunchChain } from "@/lib/launch/evmToken";
import { liquidityLinks } from "@/lib/launch/links";

const fmtNative = (wei: bigint) => { const n = Number(formatEther(wei)); return n > 0 && n < 0.000001 ? "< 0.000001" : n.toFixed(6); };
const input = "w-full h-11 rounded-xl border border-line bg-surface-2 px-3 text-[16px] sm:text-sm outline-none focus:border-line-strong";
type Step = "form" | "review" | "signing" | "sending" | "done" | "failed";

/**
 * Deploy a fixed-supply ERC-20 (contracts/BajarToken.sol) on Ethereum, Base
 * or BNB Chain from the connected wallet. No owner, no mint, no pause.
 */
export function EvmTokenLauncher({ chain, onManage }: { chain: EvmLaunchChain; onManage?: (token: string) => void }) {
  const { wallet, openModal, evm } = useWallet();
  const [f, setF] = useState({ name: "", symbol: "", supply: "1000000000" });
  const [step, setStep] = useState<Step>("form");
  const [quote, setQuote] = useState<DeployQuote | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<{ token: string; hash: string; listed: boolean } | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  // A quote is only valid for the chain and wallet it was made with.
  useEffect(() => { setStep("form"); setQuote(null); setErr(null); setPending(null); }, [chain.id, wallet?.address]);

  const supply = /^\d{1,19}$/.test(f.supply) ? BigInt(f.supply) : BigInt(0);
  const formErr = validateEvmLaunch({ name: f.name, symbol: f.symbol, supply });
  const isEvm = wallet?.chainType === "evm";

  const review = async () => {
    setErr(null); setQuote(null);
    const p = evm();
    if (!wallet || !isEvm || !p) { openModal(); return; }
    try {
      await ensureChain(p, chain.chainId);
      setQuote(await quoteDeploy(p, wallet.address, deployData(f.name, f.symbol, supply, wallet.address as `0x${string}`), chain.native));
      setStep("review");
    } catch (e) { setErr(walletErrorMessage(e).slice(0, 240)); }
  };

  const launch = async () => {
    const p = evm();
    if (!wallet || !p) return;
    setErr(null); setPending(null); setStep("signing");
    let hash: string | null = null;
    try {
      await ensureChain(p, chain.chainId);
      // Contract creation: no `to`. Pass a gas limit with headroom (some wallets under-estimate deployments).
      const tx: Record<string, string> = { from: wallet.address, data: deployData(f.name, f.symbol, supply, wallet.address as `0x${string}`), value: "0x0" };
      if (quote?.ok) tx.gas = `0x${((quote.gas * BigInt(12)) / BigInt(10)).toString(16)}`;
      hash = await p.request({ method: "eth_sendTransaction", params: [tx] }) as string;
      if (typeof hash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(hash)) throw new Error("The wallet didn't return a transaction hash.");
      setPending(hash);
      setStep("sending");
      addActivity({ chain: chain.id, hash, kind: "send", summary: `Launched ${f.symbol} (${f.name}) on ${chain.name}`, wallet: wallet.address });
      const rc = await waitReceipt(p, hash, chain.id);
      if (rc.status !== "0x1") throw new Error("The deployment transaction failed on-chain (reverted). Only the gas was spent.");
      if (!rc.contractAddress) throw new Error("The transaction confirmed but didn't create a contract.");
      // It's live: show it now. The server re-checks the receipt and contract code
      // before listing it; retry in the background while its node catches up (404) or is busy (429/5xx).
      const token = rc.contractAddress, h = hash;
      setResult({ token, hash: h, listed: false });
      setStep("done");
      void (async () => {
        for (let i = 0; i < 6; i++) {
          if (i) await new Promise((res) => setTimeout(res, 3000 * i));
          const r = await fetch("/api/launch/record", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chain: chain.id, hash: h }) }).catch(() => null);
          if (r?.ok) { setResult((x) => (x && x.hash === h ? { ...x, listed: true } : x)); return; }
          if (r && r.status !== 404 && r.status !== 429 && r.status < 500) return;
        }
      })();
    } catch (e) {
      setErr(isUserRejection(e) ? "You rejected the transaction. Nothing was deployed." : walletErrorMessage(e).slice(0, 240));
      setStep("failed");
    }
  };

  if (step === "done" && result) {
    const links = liquidityLinks(chain.id, result.token);
    return (
      <div className="space-y-4" data-testid="launch-done">
        <div className="text-center">
          <CheckCircle2 className="mx-auto text-accent" size={36} />
          <h3 className="mt-2 text-xl">{f.symbol} is live on {chain.name}</h3>
          <p className="text-xs text-muted font-mono break-all mt-1">{result.token}</p>
          {!result.listed && <p className="text-xs text-muted mt-1">Deployed — it may take a moment to appear in the Launchpad feed.</p>}
        </div>
        <div className="rounded-xl bg-surface-2 p-3 text-sm"><b>Add liquidity</b> so people can trade it: {links.map((l, i) => <span key={l.href}>{i ? ", " : " "}<a className="underline" href={l.href} target="_blank" rel="noopener noreferrer">{l.label}</a></span>)}.</div>
        <div className="flex flex-wrap gap-2">
          {onManage && <Button onClick={() => onManage(result.token)}>Manage token</Button>}
          <Link href={`/token/${chain.id}/${result.token}`}><Button variant="outline">Token page</Button></Link>
          <a href={`${chain.explorer}/tx/${result.hash}`} target="_blank" rel="noopener noreferrer"><Button variant="ghost">Transaction <ExternalLink size={13} /></Button></a>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3" data-testid="evm-launcher">
      <fieldset disabled={step !== "form"} className="space-y-2.5">
        <div className="grid grid-cols-[1fr_120px] gap-2">
          <input className={input} placeholder="Token name" maxLength={64} value={f.name} onChange={(e) => setF((s) => ({ ...s, name: e.target.value }))} aria-label="Token name" />
          <input className={input} placeholder="Symbol" maxLength={16} value={f.symbol} onChange={(e) => setF((s) => ({ ...s, symbol: e.target.value.toUpperCase().replace(/[^A-Z0-9$._-]/g, "") }))} aria-label="Symbol" />
        </div>
        <input className={input} inputMode="numeric" placeholder="Total supply" value={f.supply} onChange={(e) => setF((s) => ({ ...s, supply: e.target.value.replace(/\D/g, "") }))} aria-label="Total supply" />
      </fieldset>
      <ul className="rounded-xl border border-line divide-y divide-line text-[13px]">
        {[["Fixed supply", "Minted once to your wallet. The contract has no mint function."], ["No owner", "No admin, pause, blacklist or transfer tax — nothing anyone can change later."], ["Burnable", "Holders can burn their own tokens to lower the supply."], ["18 decimals", "The ERC-20 standard used by wallets and DEXs."]].map(([t, d]) => (
          <li key={t} className="px-3 py-2"><span className="font-medium">{t}</span><span className="block text-xs text-muted">{d}</span></li>
        ))}
      </ul>

      <div className="rounded-xl bg-surface-2 p-3 text-xs space-y-1" data-testid="launch-costs">
        <div className="flex justify-between"><span className="text-muted">Network fee (gas)</span><span className="num">{quote?.ok ? (quote.costWei === null ? "Shown in your wallet" : `≈ ${fmtNative(quote.costWei)} ${chain.native}`) : "Shown after review"}</span></div>
        <div className="flex justify-between"><span className="text-muted">Bajar launch fee</span><span className="num">None</span></div>
        <p className="text-faint pt-1">Paid to the network, not to Bajar. The full supply goes to your wallet.</p>
      </div>

      {formErr && (f.name || f.symbol) && <p className="text-xs text-down">{formErr}</p>}
      {err && <Notice tone="down">{err}</Notice>}
      {pending && step !== "done" && <p className="text-xs text-muted">Transaction: <a className="underline font-mono" href={`${chain.explorer}/tx/${pending}`} target="_blank" rel="noopener noreferrer">{pending.slice(0, 10)}…{pending.slice(-8)}</a></p>}
      {step === "review" && quote && (
        <Notice tone={quote.ok ? "info" : "down"} title={quote.ok ? "Simulation passed" : "Simulation failed"}>
          {quote.ok ? <>The deployment ran successfully in simulation ({quote.gas.toLocaleString()} gas). Your wallet will ask you to approve one transaction on {chain.name}.</> : quote.error}
        </Notice>
      )}
      {step === "form" && (!isEvm
        ? <Button className="w-full h-11" disabled={!!formErr} onClick={openModal} data-testid="launch-connect">Connect an EVM wallet to launch</Button>
        : <Button className="w-full h-11" disabled={!!formErr} onClick={review}><Rocket size={15} /> Review launch on {chain.name}</Button>)}
      {step === "review" && (
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setStep("form")}>Edit</Button>
          <Button className="flex-1 h-11" disabled={!quote?.ok} onClick={launch}><Rocket size={15} /> Launch {f.symbol}</Button>
        </div>
      )}
      {(step === "signing" || step === "sending") && <Button className="w-full h-11" disabled><Loader2 size={15} className="animate-spin" /> {step === "signing" ? "Approve in your wallet…" : `Confirming on ${chain.name}…`}</Button>}
      {step === "failed" && <Button className="w-full h-11" variant="outline" onClick={() => setStep("form")}>Back</Button>}
      <p className="text-[11px] text-faint flex gap-1.5"><ShieldCheck size={13} className="shrink-0 text-accent" /> Simulated first, signed by your wallet. Contract source is public (BajarToken.sol) and Bajar holds no role in it. Launching a token can carry legal obligations where you live.</p>
    </div>
  );
}
