"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import { Check, Copy, Droplets, ExternalLink, Globe, Image as ImageIcon, Loader2, Lock, MessageCircle, Plus, Settings2, ShieldCheck, Users } from "lucide-react";
import { useWallet } from "../wallet/WalletProvider";
import { Badge, Button, Card, CardHeader, Notice, Skeleton, Tabs } from "../ui/primitives";
import { TokenIcon } from "../ui/TokenIcon";
import { ChainIcon } from "../ui/ChainIcon";
import { EvmControls, SolanaControls } from "../discover/ManageTokens";
import { readSolanaToken, runManage } from "@/lib/launch/manage";
import { EXPLORER, liquidityLinks } from "@/lib/launch/links";
import { formatNumber, formatPrice, formatUsd, timeAgo } from "@/lib/format";
import type { DexPair } from "@/lib/types";
import { CreatePool } from "./CreatePool";

const CHAIN_NAME: Record<string, string> = { solana: "Solana", ethereum: "Ethereum", base: "Base", bsc: "BNB Chain" };
type TabId = "overview" | "profile" | "supply" | "liquidity";

interface TokenData {
  launch: { mint: string; chain: string; name: string; symbol: string; creator: string; signature: string; fixed_supply: boolean; freeze_revoked: boolean; supply: string; decimals: number; created_at: string } | null;
  siblings: { mint: string; chain: string; symbol: string; name: string }[];
  profile: { image?: string | null; description?: string | null; website?: string | null; twitter?: string | null; telegram?: string | null; discord?: string | null; updated_at?: string } | null;
  metadata: { name: string; symbol: string; uri: string; json: { image?: string; description?: string; website?: string; twitter?: string; telegram?: string } | null } | null;
}

/** Where to manage positions and lock liquidity (third-party apps; you sign there). */
const POSITIONS: Record<string, { label: string; href: string }[]> = {
  solana: [{ label: "Raydium", href: "https://raydium.io/portfolio/" }, { label: "Meteora", href: "https://app.meteora.ag/portfolio" }, { label: "Orca", href: "https://www.orca.so/portfolio" }],
  ethereum: [{ label: "Uniswap", href: "https://app.uniswap.org/positions" }],
  base: [{ label: "Uniswap", href: "https://app.uniswap.org/positions" }, { label: "Aerodrome", href: "https://aerodrome.finance/dash" }],
  bsc: [{ label: "PancakeSwap", href: "https://pancakeswap.finance/liquidity/positions" }, { label: "Uniswap", href: "https://app.uniswap.org/positions" }],
};
const LOCKERS: Record<string, { label: string; href: string }[]> = {
  solana: [{ label: "Streamflow", href: "https://app.streamflow.finance/" }, { label: "Team Finance", href: "https://www.team.finance/" }],
  ethereum: [{ label: "UNCX", href: "https://app.uncx.network/" }, { label: "Team Finance", href: "https://www.team.finance/" }],
  base: [{ label: "UNCX", href: "https://app.uncx.network/" }, { label: "Team Finance", href: "https://www.team.finance/" }],
  bsc: [{ label: "UNCX", href: "https://app.uncx.network/" }, { label: "PinkLock", href: "https://www.pinksale.finance/pinklock" }],
};
const QUOTES: Record<string, string> = { solana: "SOL or USDC", ethereum: "ETH or USDC", base: "ETH or USDC", bsc: "BNB or USDT" };

/** Link to the pool on its own DEX when we know the URL shape; otherwise DexScreener. */
function poolUrl(p: DexPair): string {
  const d = p.dex.toLowerCase(), a = p.pairAddress;
  if (d.includes("raydium")) return `https://raydium.io/liquidity/increase/?mode=add&pool_id=${a}`;
  if (d.includes("orca")) return `https://www.orca.so/pools/${a}`;
  if (d.includes("meteora")) return `https://app.meteora.ag/pools/${a}`;
  if (d.includes("uniswap")) return `https://app.uniswap.org/explore/pools/${p.chain === "bsc" ? "bnb" : p.chain}/${a}`;
  if (d.includes("aerodrome")) return `https://aerodrome.finance/liquidity?query=${a}`;
  if (d.includes("pancake")) return `https://pancakeswap.finance/liquidity/pools?search=${a}`;
  return p.url;
}

export function TokenManager({ chain, token }: { chain: string; token: string }) {
  const { wallet } = useWallet();
  const [data, setData] = useState<TokenData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<TabId>("overview");
  const [copied, setCopied] = useState(false);
  const load = useCallback(() => {
    const get = () => fetch(`/api/launch/token?chain=${chain}&token=${token}`).then(async (r) => { const b = await r.json(); if (!r.ok) throw new Error(b.error ?? "Unavailable"); return b as TokenData; });
    get().then(async (b) => {
      setData(b);
      // A Solana token that isn't recorded yet (e.g. launched before records worked): import it.
      // The server verifies on-chain which wallet created it, so the creator can manage it here.
      if (!b.launch && chain === "solana") {
        const r = await fetch("/api/launch/record", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mint: token }) }).catch(() => null);
        if (r?.ok) setData(await get());
      }
    }).catch((e) => setErr((e as Error).message));
  }, [chain, token]);
  useEffect(load, [load]);
  useEffect(() => { const h = window.location.hash.slice(1); if (["overview", "profile", "supply", "liquidity"].includes(h)) setTab(h as TabId); }, []);

  const l = data?.launch;
  const meta = data?.metadata;
  const p = data?.profile;
  const name = l?.name ?? meta?.name ?? "Token";
  const symbol = l?.symbol ?? meta?.symbol ?? "";
  const image = p?.image || meta?.json?.image || null;
  const description = p?.description || meta?.json?.description || "";
  const links = [
    { k: "Website", v: p?.website || meta?.json?.website, Icon: Globe },
    { k: "X", v: p?.twitter || meta?.json?.twitter, Icon: MessageCircle },
    { k: "Telegram", v: p?.telegram || meta?.json?.telegram, Icon: MessageCircle },
    { k: "Discord", v: p?.discord, Icon: Users },
  ].filter((x) => x.v);
  const isCreator = !!(wallet && l && wallet.address.toLowerCase() === l.creator.toLowerCase());
  const networks = data ? (data.siblings.length ? data.siblings : l ? [{ mint: l.mint, chain: l.chain, symbol: l.symbol, name: l.name }] : [{ mint: token, chain, symbol, name }]) : [];

  if (err && !data) return <Notice tone="down" title="Couldn't load this token">{err}</Notice>;

  return (
    <div className="space-y-4" data-testid="token-manager">
      <span data-app-page hidden />
      {/* Header */}
      <Card className="p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {image ? <img src={image} alt="" width={56} height={56} className="h-14 w-14 rounded-2xl object-cover bg-surface-2" referrerPolicy="no-referrer" /> : <TokenIcon symbol={symbol || "?"} size={56} />}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-[24px] sm:text-[26px] leading-tight truncate">{data ? name : <Skeleton className="h-7 w-40" />}</h1>
              {symbol && <Badge>{symbol}</Badge>}
              {l?.fixed_supply && <Badge tone="up">Fixed supply</Badge>}
              {l?.freeze_revoked && <Badge tone="up">No freeze</Badge>}
            </div>
            <div className="mt-1 flex items-center gap-2 text-[12.5px] text-muted flex-wrap">
              <ChainIcon chain={chain} size={13} />{CHAIN_NAME[chain] ?? chain}
              <button className="font-mono inline-flex items-center gap-1 hover:text-fg" onClick={() => { navigator.clipboard?.writeText(token); setCopied(true); setTimeout(() => setCopied(false), 1200); }}>{token.slice(0, 6)}…{token.slice(-4)}{copied ? <Check size={12} className="text-up" /> : <Copy size={12} />}</button>
              {l && <span>· launched {timeAgo(new Date(l.created_at).getTime())}</span>}
            </div>
          </div>
          <div className="flex gap-2 w-full sm:w-auto">
            <Link href={`/token/${chain}/${token}`}><Button variant="outline" size="sm">Token page</Button></Link>
            <a href={`${EXPLORER[chain]}${token}`} target="_blank" rel="noopener noreferrer"><Button variant="ghost" size="sm">Explorer <ExternalLink size={12} /></Button></a>
          </div>
        </div>
        {/* Networks this token launched on */}
        {networks.length > 0 && (
          <div className="mt-4 flex gap-2 overflow-x-auto no-scrollbar" data-testid="token-networks">
            {networks.map((n) => {
              const on = n.chain === chain && n.mint.toLowerCase() === token.toLowerCase();
              return (
                <Link key={`${n.chain}:${n.mint}`} href={`/launchpad/token/${n.chain}/${n.mint}#${tab}`} className={clsx("shrink-0 inline-flex items-center gap-1.5 rounded-full px-3 h-9 text-[13px] font-medium border", on ? "border-brand bg-brand-soft" : "border-line bg-surface-2 hover:bg-surface-3")}>
                  <ChainIcon chain={n.chain} size={14} />{CHAIN_NAME[n.chain] ?? n.chain}
                </Link>
              );
            })}
            <Link href="/launchpad#create" className="shrink-0 inline-flex items-center gap-1.5 rounded-full px-3 h-9 text-[13px] text-muted border border-dashed border-line-strong hover:text-fg"><Plus size={14} />Launch on another network</Link>
          </div>
        )}
      </Card>

      {!isCreator && l && <Notice title="View only">Connect the wallet that launched this token ({l.creator.slice(0, 6)}…{l.creator.slice(-4)}) to change it.</Notice>}
      {!l && data && <Notice title="Not launched with Bajar">You can still use supply, authority and liquidity tools if your wallet holds the authority. Profile editing is for tokens launched here.</Notice>}

      <Tabs<TabId> value={tab} onChange={(t) => { setTab(t); window.history.replaceState(null, "", `#${t}`); }} className="w-full sm:w-fit [&>button]:flex-1 sm:[&>button]:flex-none" tabs={[
        { id: "overview", label: "Overview" },
        { id: "profile", label: "Profile" },
        { id: "supply", label: "Supply & control" },
        { id: "liquidity", label: "Liquidity" },
      ]} />

      {tab === "overview" && (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
          <Card className="p-4 sm:p-5 space-y-3">
            <h2 className="text-base">About</h2>
            <p className="text-[14px] text-muted whitespace-pre-line">{description || "No description yet."}</p>
            {links.length > 0 && <div className="flex flex-wrap gap-2">{links.map(({ k, v, Icon }) => <a key={k} href={v!} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 hover:bg-surface-3 px-3 py-1.5 text-[13px]"><Icon size={13} />{k}</a>)}</div>}
            <dl className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-[13px]">
              <Fact k="Total supply" v={l ? formatNumber(Number(l.supply) / 10 ** l.decimals, 0) : "—"} />
              <Fact k="Decimals" v={l ? String(l.decimals) : "—"} />
              <Fact k="Creator" v={l ? `${l.creator.slice(0, 4)}…${l.creator.slice(-4)}` : "—"} />
            </dl>
            {isCreator && <div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => setTab("profile")}><ImageIcon size={13} /> Edit profile</Button><Button size="sm" variant="outline" onClick={() => setTab("liquidity")}><Droplets size={13} /> Add liquidity</Button></div>}
          </Card>
          {chain === "solana" ? <Holders mint={token} /> : <Card className="p-4 sm:p-5"><h2 className="text-base">Holders</h2><p className="text-[13px] text-muted mt-1">See holders on the explorer.</p><a className="text-brand text-[13px]" href={`${EXPLORER[chain]}${token}#balances`} target="_blank" rel="noopener noreferrer">Open holders ↗</a></Card>}
        </div>
      )}

      {tab === "profile" && <ProfileEditor chain={chain} token={token} data={data} canEdit={isCreator} onSaved={load} />}

      {tab === "supply" && (
        <Card>
          <CardHeader title={<span className="inline-flex items-center gap-2"><Settings2 size={16} className="text-brand" />Supply & control</span>} sub={chain === "solana" ? "Mint, burn, revoke authorities, edit or lock metadata. Every change is simulated and signed by you; revoking is permanent." : "This ERC-20 has a fixed supply and no owner. You can burn from your balance."} />
          {!wallet ? <p className="px-5 pb-5 text-sm text-muted">Connect a wallet to use these controls.</p> : chain === "solana" ? <SolanaControls mint={token} /> : <EvmControls chain={chain} token={token} />}
        </Card>
      )}

      {tab === "liquidity" && <Liquidity chain={chain} token={token} symbol={symbol} decimals={l?.decimals ?? (chain === "solana" ? 6 : 18)} supply={l ? Number(l.supply) / 10 ** l.decimals : null} />}
    </div>
  );
}

function Fact({ k, v }: { k: string; v: string }) {
  return <div className="rounded-xl bg-surface-2 px-3 py-2 min-w-0"><dt className="text-[11px] text-muted">{k}</dt><dd className="font-medium num truncate">{v}</dd></div>;
}

/* ── Holders (Solana) ──────────────────────────────────────────────────── */

function Holders({ mint }: { mint: string }) {
  const [rows, setRows] = useState<{ address: string; ui: number }[] | null>(null);
  const [supply, setSupply] = useState<number | null>(null);
  useEffect(() => {
    const rpc = (method: string, params: unknown[]) => fetch("/api/wallet/rpc", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chain: "solana", method, params }) }).then((r) => r.json());
    Promise.all([rpc("getTokenLargestAccounts", [mint]), rpc("getTokenSupply", [mint])]).then(([a, s]) => {
      setRows(((a.result?.value ?? []) as { address: string; uiAmount: number | null }[]).slice(0, 10).map((x) => ({ address: x.address, ui: x.uiAmount ?? 0 })));
      setSupply(s.result?.value?.uiAmount ?? null);
    }).catch(() => setRows([]));
  }, [mint]);
  return (
    <Card data-testid="holders">
      <CardHeader title={<span className="inline-flex items-center gap-2"><Users size={16} className="text-brand" />Top holders</span>} sub="Largest token accounts (pools and exchanges included)" />
      <ul className="px-4 pb-4 space-y-1.5 text-[13px]">
        {rows === null && <li><Skeleton className="h-24 w-full" /></li>}
        {rows?.length === 0 && <li className="text-muted">No holder data.</li>}
        {rows?.map((r, i) => (
          <li key={r.address} className="flex items-center gap-2">
            <span className="w-4 text-faint num">{i + 1}</span>
            <a href={`https://solscan.io/account/${r.address}`} target="_blank" rel="noopener noreferrer" className="font-mono flex-1 hover:text-brand">{r.address.slice(0, 4)}…{r.address.slice(-4)}</a>
            <span className="num">{formatNumber(r.ui, 0)}</span>
            {supply ? <span className="num text-muted w-14 text-right">{((r.ui / supply) * 100).toFixed(1)}%</span> : null}
          </li>
        ))}
      </ul>
    </Card>
  );
}

/* ── Profile (logo, description, links) ────────────────────────────────── */

function ProfileEditor({ chain, token, data, canEdit, onSaved }: { chain: string; token: string; data: TokenData | null; canEdit: boolean; onSaved: () => void }) {
  const { wallet, signMessage, solana } = useWallet();
  const p = data?.profile, mj = data?.metadata?.json;
  const [f, setF] = useState({ image: "", description: "", website: "", twitter: "", telegram: "", discord: "" });
  const [onchain, setOnchain] = useState(chain === "solana");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  useEffect(() => {
    setF({ image: p?.image ?? mj?.image ?? "", description: p?.description ?? mj?.description ?? "", website: p?.website ?? mj?.website ?? "", twitter: p?.twitter ?? mj?.twitter ?? "", telegram: p?.telegram ?? mj?.telegram ?? "", discord: p?.discord ?? "" });
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps
  const bad = useMemo(() => Object.entries(f).find(([k, v]) => k !== "description" && v && !/^https:\/\/\S+$/.test(v)), [f]);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF((s) => ({ ...s, [k]: e.target.value }));
  const field = "no-ring w-full h-11 rounded-xl bg-surface-2 px-3 text-[16px] sm:text-sm outline-none";

  const save = async () => {
    setErr(null); setOk(null);
    try {
      // 1. Bajar profile (all networks), signed by the creator.
      setBusy("Sign the profile update in your wallet…");
      const s = await fetch("/api/launch/profile/start", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chain, token, fields: f }) }).then((r) => r.json());
      if (!s.message) throw new Error(s.error ?? "Couldn't start");
      const signature = await signMessage(s.message);
      const v = await fetch("/api/launch/profile/verify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ signature }) }).then((r) => r.json());
      if (!v.ok) throw new Error(v.error ?? "Couldn't save");
      let note = "Profile saved on Bajar.";
      // 2. Solana: also update the on-chain metadata that wallets and explorers read.
      if (chain === "solana" && onchain && wallet) {
        setBusy("Updating on-chain metadata…");
        const state = await readSolanaToken(token, wallet.address);
        if (!state.metadata?.isMutable || state.metadata.updateAuthority !== wallet.address) {
          note += " On-chain metadata wasn't changed: it's locked or controlled by another wallet.";
        } else {
          const r = await fetch("/api/launch/metadata", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: state.metadata.name, symbol: state.metadata.symbol, description: f.description, image: f.image || undefined, website: f.website || undefined, twitter: f.twitter || undefined, telegram: f.telegram || undefined }) });
          const b = await r.json();
          if (!r.ok || typeof b.uri !== "string") throw new Error(b.error ?? "Couldn't host the new metadata.");
          const prov = solana();
          if (!prov?.signTransaction) throw new Error("This wallet can't sign transactions.");
          setBusy("Approve the metadata update in your wallet…");
          await runManage(state, wallet.address, { kind: "updateMetadata", name: state.metadata.name, symbol: state.metadata.symbol, uri: b.uri }, (tx) => prov.signTransaction!(tx));
          note += b.dropped?.length ? ` On-chain metadata updated (without ${b.dropped.join(", ")}, to fit the 200-byte limit).` : " On-chain metadata updated.";
        }
      }
      setOk(note);
      onSaved();
    } catch (e) {
      const m = (e as Error).message ?? String(e);
      setErr(/reject|denied|cancel/i.test(m) ? "You cancelled. Nothing changed." : m);
    } finally { setBusy(null); }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
      <Card className="p-4 sm:p-5 space-y-2.5" data-testid="profile-editor">
        <h2 className="text-base">Token profile</h2>
        <p className="text-[12.5px] text-muted">Logo, description and links shown on Bajar{chain === "solana" ? " and, if your metadata isn't locked, in wallets and explorers too" : ""}.</p>
        <fieldset disabled={!canEdit || !!busy} className="space-y-2.5">
          <input className={field} placeholder="Logo image URL — https://…" value={f.image} onChange={set("image")} aria-label="Logo image URL" />
          <textarea className={clsx(field, "h-28 py-2")} maxLength={600} placeholder="Description" value={f.description} onChange={set("description")} aria-label="Description" />
          <div className="grid sm:grid-cols-2 gap-2">
            <input className={field} placeholder="Website https://…" value={f.website} onChange={set("website")} aria-label="Website" />
            <input className={field} placeholder="X / Twitter https://…" value={f.twitter} onChange={set("twitter")} aria-label="Twitter" />
            <input className={field} placeholder="Telegram https://…" value={f.telegram} onChange={set("telegram")} aria-label="Telegram" />
            <input className={field} placeholder="Discord https://…" value={f.discord} onChange={set("discord")} aria-label="Discord" />
          </div>
          {chain === "solana" && <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={onchain} onChange={(e) => setOnchain(e.target.checked)} />Also update on-chain metadata (one Solana transaction)</label>}
        </fieldset>
        {bad && <p className="text-xs text-down">{bad[0]}: links must start with https://</p>}
        {err && <Notice tone="down"><span className="whitespace-pre-line break-words">{err}</span></Notice>}
        {ok && <Notice title="Saved">{ok}</Notice>}
        <Button className="w-full h-11" disabled={!canEdit || !!busy || !!bad} onClick={save} data-testid="profile-save">{busy ? <><Loader2 size={15} className="animate-spin" /> {busy}</> : "Save profile"}</Button>
        {!canEdit && <p className="text-[12px] text-faint">Only the wallet that launched this token can edit its profile.</p>}
      </Card>
      <Card className="p-4 sm:p-5">
        <h3 className="text-[14px] font-semibold mb-2">Preview</h3>
        <div className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {f.image && /^https:\/\//.test(f.image) ? <img src={f.image} alt="" width={48} height={48} className="h-12 w-12 rounded-xl object-cover bg-surface-2" referrerPolicy="no-referrer" /> : <div className="h-12 w-12 rounded-xl bg-surface-2 grid place-items-center text-muted"><ImageIcon size={18} /></div>}
          <div className="min-w-0"><div className="font-semibold">{data?.launch?.name ?? data?.metadata?.name ?? "Token"}</div><div className="text-[12px] text-muted">{data?.launch?.symbol ?? data?.metadata?.symbol}</div></div>
        </div>
        <p className="text-[13px] text-muted mt-3 whitespace-pre-line line-clamp-6">{f.description || "Your description appears here."}</p>
        <p className="text-[11.5px] text-faint mt-3 flex gap-1.5"><ShieldCheck size={13} className="shrink-0" /> Signing the profile is free and can&apos;t move funds.</p>
      </Card>
    </div>
  );
}

/* ── Liquidity: pairs, create pool, positions, locks ───────────────────── */

function Liquidity({ chain, token, symbol, decimals, supply }: { chain: string; token: string; symbol: string; decimals: number; supply: number | null }) {
  const [pairs, setPairs] = useState<DexPair[] | null>(null);
  const [calc, setCalc] = useState({ tokens: "", quote: "", quotePrice: "" });
  useEffect(() => {
    fetch(`/api/dex/pairs?chain=${chain}&address=${token}`).then((r) => r.json()).then((b) => setPairs((b.data ?? []) as DexPair[])).catch(() => setPairs([]));
  }, [chain, token]);
  const t = Number(calc.tokens), q = Number(calc.quote), qp = Number(calc.quotePrice);
  const priceInQuote = t > 0 && q > 0 ? q / t : null;
  const priceUsd = priceInQuote !== null && qp > 0 ? priceInQuote * qp : null;
  const totalLiq = (pairs ?? []).reduce((s, p) => s + (p.liquidityUsd ?? 0), 0);
  const field = "no-ring w-full h-10 rounded-xl bg-surface-2 px-3 text-[16px] sm:text-sm num outline-none";

  return (
    <div className="space-y-4" data-testid="liquidity">
      <Card>
        <CardHeader title={<span className="inline-flex items-center gap-2"><Droplets size={16} className="text-brand" />Pairs & pools</span>} sub={pairs?.length ? `${pairs.length} pool${pairs.length === 1 ? "" : "s"} · ${formatUsd(totalLiq)} total liquidity` : "Live from DexScreener"} />
        {pairs === null ? <div className="px-5 pb-5"><Skeleton className="h-16 w-full" /></div> : pairs.length === 0 ? (
          <p className="px-5 pb-5 text-[13.5px] text-muted">No pools yet. Create the first one below so {symbol || "your token"} can be traded.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px] min-w-[640px]">
              <thead className="text-xs text-muted border-y border-line"><tr><th className="text-left px-4 py-2 font-medium">Pair</th><th className="text-left px-3 font-medium">DEX</th><th className="text-right px-3 font-medium">Price</th><th className="text-right px-3 font-medium">Liquidity</th><th className="text-right px-3 font-medium">24h volume</th><th className="text-right px-3 font-medium">24h txns</th><th className="px-4" /></tr></thead>
              <tbody>
                {pairs.map((p) => (
                  <tr key={p.pairAddress} className="border-b border-line/60 last:border-0">
                    <td className="px-4 py-2.5 font-semibold">{p.base.symbol}/{p.quote.symbol}<span className="block text-[11px] text-muted font-normal">{p.createdAt ? timeAgo(p.createdAt) : ""}</span></td>
                    <td className="px-3 capitalize">{p.dex}{p.labels?.length ? <span className="text-muted"> {p.labels.join(" ")}</span> : null}</td>
                    <td className="px-3 text-right num">{formatPrice(p.priceUsd)}</td>
                    <td className="px-3 text-right num">{formatUsd(p.liquidityUsd)}</td>
                    <td className="px-3 text-right num">{formatUsd(p.volume.h24)}</td>
                    <td className="px-3 text-right num">{p.txns.h24.buys + p.txns.h24.sells}</td>
                    <td className="px-4 text-right whitespace-nowrap">
                      <a href={poolUrl(p)} target="_blank" rel="noopener noreferrer" className="text-brand font-medium">Add / remove ↗</a>
                      <Link href={`/token/${chain}/${token}?pair=${p.pairAddress}&mode=swap`} className="ml-3 text-muted hover:text-fg">Trade</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-4 sm:p-5 space-y-3" data-testid="create-pool">
          <h2 className="text-base">Create a pool</h2>
          {pairs !== null && pairs.length === 0 && <CreatePool chain={chain} token={token} symbol={symbol || "TOKEN"} decimals={decimals} />}
          <p className="text-[13px] text-muted">{pairs?.length === 0 ? "Or plan it here and create it on a DEX yourself:" : `Pair ${symbol || "your token"} with ${QUOTES[chain]}. The amounts you deposit set the starting price.`}</p>
          <div className="grid grid-cols-3 gap-2">
            <label className="text-[11.5px] text-muted">{symbol || "Tokens"} to add<input className={field} inputMode="decimal" value={calc.tokens} onChange={(e) => setCalc((c) => ({ ...c, tokens: e.target.value.replace(/[^\d.]/g, "") }))} aria-label="Token amount" /></label>
            <label className="text-[11.5px] text-muted">Quote to add<input className={field} inputMode="decimal" value={calc.quote} onChange={(e) => setCalc((c) => ({ ...c, quote: e.target.value.replace(/[^\d.]/g, "") }))} aria-label="Quote amount" /></label>
            <label className="text-[11.5px] text-muted">Quote price $<input className={field} inputMode="decimal" value={calc.quotePrice} onChange={(e) => setCalc((c) => ({ ...c, quotePrice: e.target.value.replace(/[^\d.]/g, "") }))} aria-label="Quote price in USD" /></label>
          </div>
          <dl className="grid grid-cols-3 gap-2 text-[13px]">
            <Fact k="Start price (quote)" v={priceInQuote !== null ? formatNumber(priceInQuote, 10) : "—"} />
            <Fact k="Start price ($)" v={priceUsd !== null ? formatPrice(priceUsd) : "—"} />
            <Fact k="Implied FDV" v={priceUsd !== null && supply ? formatUsd(priceUsd * supply) : "—"} />
          </dl>
          <div className="flex flex-wrap gap-2">
            {liquidityLinks(chain, token).map((x) => <a key={x.href} href={x.href} target="_blank" rel="noopener noreferrer"><Button size="sm"><Plus size={13} /> {x.label}</Button></a>)}
          </div>
          <p className="text-[11.5px] text-faint">New pools are easy to snipe: add enough liquidity, consider locking LP tokens, and never share a pool before it&apos;s funded.</p>
        </Card>

        <Card className="p-4 sm:p-5 space-y-3">
          <h2 className="text-base">Positions & locks</h2>
          <div>
            <div className="text-[12px] text-muted mb-1.5">Manage or withdraw your liquidity positions</div>
            <div className="flex flex-wrap gap-2">{(POSITIONS[chain] ?? []).map((x) => <a key={x.href} href={x.href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 rounded-full bg-surface-2 hover:bg-surface-3 px-3 py-1.5 text-[13px]">{x.label}<ExternalLink size={11} /></a>)}</div>
          </div>
          <div>
            <div className="text-[12px] text-muted mb-1.5 inline-flex items-center gap-1"><Lock size={12} /> Lock LP tokens or team tokens (third-party lockers)</div>
            <div className="flex flex-wrap gap-2">{(LOCKERS[chain] ?? []).map((x) => <a key={x.href} href={x.href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 rounded-full bg-surface-2 hover:bg-surface-3 px-3 py-1.5 text-[13px]">{x.label}<ExternalLink size={11} /></a>)}</div>
          </div>
          <p className="text-[11.5px] text-faint">These apps are independent of Bajar. Check the contract you approve; Bajar never holds your liquidity.</p>
        </Card>
      </div>
    </div>
  );
}
