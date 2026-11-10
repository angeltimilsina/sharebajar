"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import { ChevronDown, ExternalLink, Flame, Loader2, Lock, PenLine, Plus, ShieldCheck, ShieldOff, Snowflake, Settings2 } from "lucide-react";
import { decodeFunctionResult, encodeFunctionData, formatUnits, parseUnits } from "viem";
import { useWallet } from "../wallet/WalletProvider";
import { Badge, Button, Card, CardHeader, Notice, Skeleton } from "../ui/primitives";
import { TokenIcon } from "../ui/TokenIcon";
import { ChainIcon } from "../ui/ChainIcon";
import { describe, readSolanaToken, runManage, type ManageAction, type SolanaTokenState } from "@/lib/launch/manage";
import { BAJAR_TOKEN_ABI } from "@/lib/launch/erc20Artifact";
import { EVM_LAUNCH_CHAINS, burnData, ensureChain, isUserRejection, waitReceipt, walletErrorMessage } from "@/lib/launch/evmToken";
import { EXPLORER, liquidityLinks } from "@/lib/launch/links";
import { addActivity } from "@/lib/activity";

interface Launch { mint: string; chain: string; name: string; symbol: string; creator: string; fixed_supply: boolean; freeze_revoked: boolean; created_at: string }
const CHAIN_NAME: Record<string, string> = { solana: "Solana", ethereum: "Ethereum", base: "Base", bsc: "BNB Chain" };

/** Tokens you launched with the connected wallet, each with its after-launch controls. */
export function ManageTokens({ focus }: { focus?: { chain: string; token: string } | null }) {
  const { wallet } = useWallet();
  const [list, setList] = useState<Launch[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [extra, setExtra] = useState("");
  const load = useCallback(() => {
    if (!wallet) { setList(null); return; }
    fetch(`/api/launch/record?creator=${encodeURIComponent(wallet.address)}`).then((r) => r.json()).then((b) => setList(b.launches ?? [])).catch(() => setList([]));
  }, [wallet]);
  useEffect(load, [load]);
  useEffect(() => { if (focus) setOpen(`${focus.chain}:${focus.token}`); }, [focus]);

  if (!wallet) return null;
  const chainOfWallet = wallet.chainType === "solana" ? ["solana"] : ["ethereum", "base", "bsc"];
  const rows: { chain: string; token: string; symbol: string; name: string }[] = (list ?? []).filter((l) => chainOfWallet.includes(l.chain)).map((l) => ({ chain: l.chain, token: l.mint, symbol: l.symbol, name: l.name }));
  if (focus && !rows.some((r) => r.token.toLowerCase() === focus.token.toLowerCase())) rows.unshift({ chain: focus.chain, token: focus.token, symbol: "", name: "Just launched" });

  return (
    <Card id="manage" className="scroll-mt-24" data-testid="manage-tokens">
      <CardHeader title={<span className="inline-flex items-center gap-2"><Settings2 size={16} className="text-brand" />Your tokens</span>} sub="Controls for tokens launched from this wallet. Every change is signed by you; revoking is permanent." />
      <ul className="divide-y divide-line/70">
        {list === null && <li className="px-5 pb-5"><Skeleton className="h-12 w-full" /></li>}
        {list !== null && rows.length === 0 && <li className="px-5 pb-4 text-sm text-muted">No tokens launched from this wallet yet.</li>}
        {rows.map((r) => {
          const k = `${r.chain}:${r.token}`;
          const isOpen = open === k;
          return (
            <li key={k}>
              <button onClick={() => setOpen(isOpen ? null : k)} aria-expanded={isOpen} className="w-full flex items-center gap-3 px-4 sm:px-5 py-3 text-left hover:bg-surface-2/60">
                <span className="relative"><TokenIcon symbol={r.symbol || "?"} size={32} /><span className="absolute -bottom-0.5 -right-0.5 rounded-full bg-surface p-[1.5px]"><ChainIcon chain={r.chain} size={13} /></span></span>
                <span className="min-w-0 flex-1"><span className="block font-semibold truncate">{r.symbol || "New token"} <span className="text-muted font-normal">· {r.name}</span></span><span className="block text-[11.5px] text-muted font-mono truncate">{r.token}</span></span>
                <ChevronDown size={16} className={clsx("text-faint transition-transform", isOpen && "rotate-180")} />
              </button>
              {isOpen && (r.chain === "solana" ? <SolanaControls mint={r.token} /> : <EvmControls chain={r.chain} token={r.token} />)}
            </li>
          );
        })}
      </ul>
      <form className="px-4 sm:px-5 py-3 border-t border-line/70 flex gap-2" onSubmit={(e) => {
        e.preventDefault();
        const t = extra.trim();
        const chain = wallet.chainType === "solana" ? (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(t) ? "solana" : null) : (/^0x[0-9a-fA-F]{40}$/.test(t) ? (EVM_LAUNCH_CHAINS.find((c) => c.chainId === wallet.chainId)?.id ?? "ethereum") : null);
        if (!chain) return;
        setList((l) => [...(l ?? []), { mint: t, chain, name: "Added by address", symbol: "", creator: wallet.address, fixed_supply: false, freeze_revoked: false, created_at: new Date().toISOString() }]);
        setOpen(`${chain}:${t}`); setExtra("");
      }}>
        <input value={extra} onChange={(e) => setExtra(e.target.value)} placeholder={wallet.chainType === "solana" ? "Manage another mint address" : "Manage another token address (current network)"} aria-label="Token address" className="no-ring flex-1 min-w-0 h-10 rounded-xl bg-surface-2 px-3 text-[16px] sm:text-sm font-mono outline-none" />
        <Button variant="outline" type="submit"><Plus size={14} /> Open</Button>
      </form>
    </Card>
  );
}

function Row({ icon, title, sub, children }: { icon: React.ReactNode; title: string; sub: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl bg-surface-2 px-3 py-2.5">
      <span className="text-muted">{icon}</span>
      <div className="min-w-0 flex-1"><div className="text-[13.5px] font-medium">{title}</div><div className="text-[12px] text-muted">{sub}</div></div>
      {children}
    </div>
  );
}

function SolanaControls({ mint }: { mint: string }) {
  const { wallet, solana } = useWallet();
  const [s, setS] = useState<SolanaTokenState | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pending, setPending] = useState<ManageAction | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [amt, setAmt] = useState({ burn: "", mint: "" });
  const [md, setMd] = useState<{ name: string; symbol: string; uri: string } | null>(null);
  const owner = wallet?.address ?? "";
  const refresh = useCallback(() => { readSolanaToken(mint, owner).then((x) => { setS(x); setErr(null); }).catch((e) => setErr((e as Error).message)); }, [mint, owner]);
  useEffect(refresh, [refresh]);
  if (err && !s) return <div className="px-5 pb-4"><Notice tone="down">{err}</Notice></div>;
  if (!s) return <div className="px-5 pb-4"><Skeleton className="h-24 w-full" /></div>;
  const sym = s.metadata?.symbol || "tokens";
  const fmt = (r: bigint) => formatUnits(r, s.decimals);
  const raw = (v: string) => { try { return v ? parseUnits(v, s.decimals) : BigInt(0); } catch { return BigInt(0); } };
  const canMeta = !!s.metadata?.isMutable && s.metadata.updateAuthority === owner;

  const confirm = async () => {
    const p = solana();
    if (!pending || !p?.signTransaction) { setErr("This wallet can't sign transactions."); return; }
    setBusy(true); setErr(null);
    try {
      const sig = await runManage(s, owner, pending, (tx) => p.signTransaction!(tx));
      addActivity({ chain: "solana", hash: sig, kind: "send", summary: describe(pending, sym, s.decimals).split(".")[0], wallet: owner, assetHref: `/token/solana/${mint}` });
      setDone(sig); setPending(null); setMd(null); setAmt({ burn: "", mint: "" });
      refresh();
    } catch (e) {
      const m = (e as Error).message;
      setErr(/reject|denied|cancel/i.test(m) ? "You rejected the transaction. Nothing changed." : m);
    } finally { setBusy(false); }
  };

  return (
    <div className="px-4 sm:px-5 pb-4 space-y-2" data-testid="manage-solana">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[12.5px]">
        <Stat k="Supply" v={fmt(s.supplyRaw)} />
        <Stat k="Your balance" v={fmt(s.balanceRaw)} />
        <Stat k="Mint authority" v={s.mintAuthority ? (s.mintAuthority === owner ? "You" : "Other wallet") : "Revoked"} good={!s.mintAuthority} />
        <Stat k="Freeze authority" v={s.freezeAuthority ? (s.freezeAuthority === owner ? "You" : "Other wallet") : "Revoked"} good={!s.freezeAuthority} />
      </div>

      {s.mintAuthority === owner && (
        <>
          <Row icon={<ShieldOff size={16} />} title="Revoke mint authority" sub="Make the supply fixed forever. Buyers and screeners look for this."><Button size="sm" variant="outline" onClick={() => setPending({ kind: "revokeMint" })} data-testid="ctl-revoke-mint">Revoke</Button></Row>
          <Row icon={<Plus size={16} />} title="Mint more" sub="Create new tokens into your wallet while you hold the authority.">
            <input value={amt.mint} onChange={(e) => setAmt((a) => ({ ...a, mint: e.target.value.replace(/[^\d.]/g, "") }))} placeholder="Amount" aria-label="Mint amount" className="no-ring w-28 h-9 rounded-lg bg-surface px-2 text-[16px] sm:text-sm num outline-none" />
            <Button size="sm" variant="outline" disabled={raw(amt.mint) <= BigInt(0)} onClick={() => setPending({ kind: "mint", amountRaw: raw(amt.mint) })}>Mint</Button>
          </Row>
        </>
      )}
      {s.freezeAuthority === owner && <Row icon={<Snowflake size={16} />} title="Revoke freeze authority" sub="Most DEXs and screeners require this."><Button size="sm" variant="outline" onClick={() => setPending({ kind: "revokeFreeze" })} data-testid="ctl-revoke-freeze">Revoke</Button></Row>}
      <Row icon={<Flame size={16} />} title="Burn" sub={`Destroy ${sym} from your wallet to lower the supply.`}>
        <input value={amt.burn} onChange={(e) => setAmt((a) => ({ ...a, burn: e.target.value.replace(/[^\d.]/g, "") }))} placeholder="Amount" aria-label="Burn amount" className="no-ring w-28 h-9 rounded-lg bg-surface px-2 text-[16px] sm:text-sm num outline-none" />
        <Button size="sm" variant="outline" disabled={raw(amt.burn) <= BigInt(0) || raw(amt.burn) > s.balanceRaw} onClick={() => setPending({ kind: "burn", amountRaw: raw(amt.burn) })} data-testid="ctl-burn">Burn</Button>
      </Row>
      {canMeta ? (
        <>
          <Row icon={<PenLine size={16} />} title="Edit metadata" sub={`${s.metadata!.name} · ${s.metadata!.symbol}`}><Button size="sm" variant="outline" onClick={() => setMd(md ? null : { name: s.metadata!.name, symbol: s.metadata!.symbol, uri: s.metadata!.uri })}>{md ? "Close" : "Edit"}</Button></Row>
          {md && (
            <div className="rounded-xl bg-surface-2 p-3 space-y-2">
              <div className="grid grid-cols-[1fr_110px] gap-2">
                <input value={md.name} maxLength={32} onChange={(e) => setMd({ ...md, name: e.target.value })} aria-label="New name" className="no-ring h-9 rounded-lg bg-surface px-2 text-[16px] sm:text-sm outline-none" />
                <input value={md.symbol} maxLength={10} onChange={(e) => setMd({ ...md, symbol: e.target.value.toUpperCase() })} aria-label="New symbol" className="no-ring h-9 rounded-lg bg-surface px-2 text-[16px] sm:text-sm outline-none" />
              </div>
              <input value={md.uri} onChange={(e) => setMd({ ...md, uri: e.target.value })} placeholder="Metadata JSON link (https:// or ipfs://)" aria-label="New metadata link" className="no-ring w-full h-9 rounded-lg bg-surface px-2 text-[16px] sm:text-sm outline-none" />
              <Button size="sm" onClick={() => setPending({ kind: "updateMetadata", ...md })}>Review change</Button>
            </div>
          )}
          <Row icon={<Lock size={16} />} title="Lock metadata" sub="Name, symbol and image can never change again."><Button size="sm" variant="outline" onClick={() => setPending({ kind: "lockMetadata" })} data-testid="ctl-lock">Lock</Button></Row>
        </>
      ) : (
        <Row icon={<Lock size={16} />} title="Metadata" sub={s.metadata ? (s.metadata.isMutable ? "Editable by another wallet" : "Locked — can't be changed") : "No metadata account"} />
      )}

      <TokenLinks chain="solana" token={mint} />

      {pending && (
        <Notice tone="warn" title="Approve this change in your wallet">
          <p>{describe(pending, sym, s.decimals)}</p>
          <div className="mt-2 flex gap-2">
            <Button size="sm" onClick={confirm} disabled={busy} data-testid="ctl-confirm">{busy ? <><Loader2 size={13} className="animate-spin" /> Waiting…</> : "Simulate & sign"}</Button>
            <Button size="sm" variant="ghost" onClick={() => setPending(null)} disabled={busy}>Cancel</Button>
          </div>
        </Notice>
      )}
      {err && <Notice tone="down">{err}</Notice>}
      {done && <Notice title="Done"><a className="underline" href={`https://solscan.io/tx/${done}`} target="_blank" rel="noopener noreferrer">View transaction</a></Notice>}
    </div>
  );
}

async function evmRead<T>(request: (a: { method: string; params?: unknown[] }) => Promise<unknown>, to: string, fn: "name" | "symbol" | "totalSupply" | "decimals" | "balanceOf", args: unknown[] = []): Promise<T> {
  const data = encodeFunctionData({ abi: BAJAR_TOKEN_ABI, functionName: fn, args } as never);
  const out = await request({ method: "eth_call", params: [{ to, data }, "latest"] }) as `0x${string}`;
  return decodeFunctionResult({ abi: BAJAR_TOKEN_ABI, functionName: fn, data: out } as never) as T;
}

function EvmControls({ chain, token }: { chain: string; token: string }) {
  const { wallet, evm } = useWallet();
  const c = EVM_LAUNCH_CHAINS.find((x) => x.id === chain) ?? EVM_LAUNCH_CHAINS[0];
  const [s, setS] = useState<{ name: string; symbol: string; supply: bigint; balance: bigint; decimals: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [amt, setAmt] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    const p = evm();
    if (!p || !wallet) return;
    try {
      await ensureChain(p, c.chainId);
      const r = p.request.bind(p);
      const [name, symbol, supply, decimals, balance] = await Promise.all([evmRead<string>(r, token, "name"), evmRead<string>(r, token, "symbol"), evmRead<bigint>(r, token, "totalSupply"), evmRead<number>(r, token, "decimals"), evmRead<bigint>(r, token, "balanceOf", [wallet.address])]);
      setS({ name, symbol, supply, decimals: Number(decimals), balance }); setErr(null);
    } catch (e) { setErr((e as Error).message.slice(0, 200)); }
  }, [evm, wallet, token, c.chainId]);
  useEffect(() => { void refresh(); }, [refresh]);
  if (err && !s) return <div className="px-5 pb-4"><Notice tone="down">{err}</Notice></div>;
  if (!s) return <div className="px-5 pb-4"><Skeleton className="h-20 w-full" /></div>;
  const raw = (() => { try { return amt ? parseUnits(amt, s.decimals) : BigInt(0); } catch { return BigInt(0); } })();

  const burn = async () => {
    const p = evm();
    if (!p || !wallet) return;
    setBusy(true); setErr(null);
    try {
      await ensureChain(p, c.chainId);
      const data = s.decimals === 18 ? burnData(amt) : encodeFunctionData({ abi: BAJAR_TOKEN_ABI, functionName: "burn", args: [raw] });
      await p.request({ method: "eth_call", params: [{ from: wallet.address, to: token, data }, "latest"] }); // simulate
      const hash = await p.request({ method: "eth_sendTransaction", params: [{ from: wallet.address, to: token, data }] }) as string;
      addActivity({ chain: c.id, hash, kind: "send", summary: `Burned ${amt} ${s.symbol}`, wallet: wallet.address });
      const rc = await waitReceipt(p, hash, c.id);
      if (rc.status !== "0x1") throw new Error("Burn failed on-chain.");
      setDone(hash); setAmt(""); void refresh();
    } catch (e) {
      const m = (e as Error).message;
      setErr(isUserRejection(e) ? "You rejected the transaction. Nothing changed." : walletErrorMessage(e).slice(0, 200));
    } finally { setBusy(false); }
  };

  return (
    <div className="px-4 sm:px-5 pb-4 space-y-2" data-testid="manage-evm">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[12.5px]">
        <Stat k="Supply" v={formatUnits(s.supply, s.decimals)} />
        <Stat k="Your balance" v={formatUnits(s.balance, s.decimals)} />
        <Stat k="Owner" v="None" good />
        <Stat k="Network" v={CHAIN_NAME[chain] ?? chain} />
      </div>
      <Row icon={<ShieldCheck size={16} />} title="Fixed supply, no owner" sub="This contract has no mint, pause or admin functions, so there's nothing to revoke." />
      <Row icon={<Flame size={16} />} title="Burn" sub={`Destroy ${s.symbol} from your wallet to lower the supply.`}>
        <input value={amt} onChange={(e) => setAmt(e.target.value.replace(/[^\d.]/g, ""))} placeholder="Amount" aria-label="Burn amount" className="no-ring w-28 h-9 rounded-lg bg-surface px-2 text-[16px] sm:text-sm num outline-none" />
        <Button size="sm" variant="outline" disabled={busy || raw <= BigInt(0) || raw > s.balance} onClick={burn}>{busy ? <Loader2 size={13} className="animate-spin" /> : "Burn"}</Button>
      </Row>
      <TokenLinks chain={chain} token={token} explorer={`${c.explorer}/address/${token}#code`} />
      {err && <Notice tone="down">{err}</Notice>}
      {done && <Notice title="Done"><a className="underline" href={`${c.explorer}/tx/${done}`} target="_blank" rel="noopener noreferrer">View transaction</a></Notice>}
    </div>
  );
}

function TokenLinks({ chain, token, explorer }: { chain: string; token: string; explorer?: string }) {
  return (
    <div className="flex flex-wrap items-center gap-2 pt-1 text-[12.5px]">
      <span className="text-muted">Add liquidity:</span>
      {liquidityLinks(chain, token).map((l) => <a key={l.href} href={l.href} target="_blank" rel="noopener noreferrer" className="rounded-full bg-surface-2 px-2.5 py-1 hover:bg-surface-3 inline-flex items-center gap-1">{l.label}<ExternalLink size={11} /></a>)}
      <span className="flex-1" />
      <Link href={`/token/${chain}/${token}`} className="text-brand font-medium">Token page</Link>
      <a href={explorer ?? `${EXPLORER[chain]}${token}`} target="_blank" rel="noopener noreferrer" className="text-muted hover:text-fg inline-flex items-center gap-1">Explorer<ExternalLink size={11} /></a>
    </div>
  );
}

function Stat({ k, v, good }: { k: string; v: string; good?: boolean }) {
  return (
    <div className="rounded-xl bg-surface-2 px-3 py-2 min-w-0">
      <div className="text-[11px] text-muted">{k}</div>
      <div className={clsx("font-medium num truncate", good && "text-up")}>{good && v !== "None" ? <Badge tone="up">{v}</Badge> : v}</div>
    </div>
  );
}
