import Link from "next/link";
import { decodeFunctionResult, encodeFunctionData } from "viem";
import { Droplets, ExternalLink, Globe, MessageCircle, Settings2 } from "lucide-react";
import { srpc } from "@/lib/treasury/solana";
import { erpc } from "@/lib/treasury/evm";
import { BAJAR_TOKEN_ABI } from "@/lib/launch/erc20Artifact";
import { launchOf, profileOf, readMetadataJson } from "@/lib/launch/profile";
import { EXPLORER } from "@/lib/launch/links";
import { formatNumber } from "@/lib/format";
import { Badge, Card, Notice } from "@/components/ui/primitives";
import { TokenIcon } from "@/components/ui/TokenIcon";
import { ChainIcon } from "@/components/ui/ChainIcon";

interface Info { name: string; symbol: string; decimals: number; supply: number | null; mintAuthority?: string | null; freezeAuthority?: string | null; image?: string; description?: string; website?: string; twitter?: string; telegram?: string; discord?: string; creator?: string; launchedAt?: string }

async function solanaInfo(mint: string): Promise<Info | null> {
  const acc = await srpc<{ value: { data: { parsed?: { type: string; info: { decimals: number; supply: string; mintAuthority: string | null; freezeAuthority: string | null } } } } | null }>("getAccountInfo", [mint, { encoding: "jsonParsed" }]).catch(() => null);
  const m = acc?.value?.data?.parsed?.type === "mint" ? acc.value.data.parsed.info : null;
  if (!m) return null;
  const { tokenMetadata } = await import("@/lib/launch/metadata");
  const md = await tokenMetadata(mint).catch(() => null);
  const j = md?.uri ? await readMetadataJson(md.uri).catch(() => null) : null;
  return { name: md?.name || "Unknown token", symbol: md?.symbol || "?", decimals: m.decimals, supply: Number(m.supply) / 10 ** m.decimals, mintAuthority: m.mintAuthority, freezeAuthority: m.freezeAuthority, ...j };
}

async function evmInfo(chain: string, token: string): Promise<Info | null> {
  const read = async (fn: "name" | "symbol" | "decimals" | "totalSupply") => {
    const out = await erpc<`0x${string}`>(chain, "eth_call", [{ to: token, data: encodeFunctionData({ abi: BAJAR_TOKEN_ABI, functionName: fn }) }, "latest"]);
    return decodeFunctionResult({ abi: BAJAR_TOKEN_ABI, functionName: fn, data: out });
  };
  try {
    const [name, symbol, decimals, supply] = await Promise.all([read("name"), read("symbol"), read("decimals"), read("totalSupply")]);
    return { name: String(name), symbol: String(symbol), decimals: Number(decimals), supply: Number(supply as bigint) / 10 ** Number(decimals) };
  } catch { return null; }
}

/** Token page for a token that has no trading pool yet (e.g. just launched): details, creator tools, next steps. */
export async function PrePoolToken({ chain, chainName, address }: { chain: string; chainName: string; address: string }) {
  const [onchain, launch, profile] = await Promise.all([
    chain === "solana" ? solanaInfo(address) : evmInfo(chain, address),
    launchOf(chain, address).catch(() => null),
    profileOf(chain, address).catch(() => null),
  ]);
  if (!onchain) {
    return <Notice title="Token not found" className="my-10">No token was found at <span className="num">{address}</span> on {chainName}.</Notice>;
  }
  const t: Info = { ...onchain, ...Object.fromEntries(Object.entries(profile ?? {}).filter(([, v]) => v)), creator: launch?.creator, launchedAt: launch?.created_at };
  const links = [["Website", t.website, Globe], ["X", t.twitter, MessageCircle], ["Telegram", t.telegram, MessageCircle], ["Discord", t.discord, MessageCircle]].filter(([, v]) => v) as [string, string, typeof Globe][];
  return (
    <div className="space-y-4 max-w-4xl" data-testid="prepool-token">
      <Card className="p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {t.image && /^https:\/\//.test(t.image) ? <img src={t.image} alt="" width={56} height={56} className="h-14 w-14 rounded-2xl object-cover bg-surface-2" referrerPolicy="no-referrer" /> : <TokenIcon symbol={t.symbol} size={56} />}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-[24px] sm:text-[28px] leading-tight truncate">{t.name}</h1>
              <Badge>{t.symbol}</Badge>
              {chain === "solana" && t.mintAuthority === null && <Badge tone="up">Fixed supply</Badge>}
              {chain === "solana" && t.freezeAuthority === null && <Badge tone="up">No freeze</Badge>}
              {launch && <Badge tone="brand">Launched on Bajar</Badge>}
            </div>
            <div className="mt-1 text-[12.5px] text-muted flex items-center gap-1.5"><ChainIcon chain={chain} size={13} />{chainName} · <span className="font-mono">{address.slice(0, 6)}…{address.slice(-4)}</span></div>
          </div>
        </div>
        {t.description && <p className="mt-3 text-[14px] text-muted whitespace-pre-line">{t.description}</p>}
        {links.length > 0 && <div className="mt-3 flex flex-wrap gap-2">{links.map(([k, v, Icon]) => <a key={k} href={v} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 hover:bg-surface-3 px-3 py-1.5 text-[13px]"><Icon size={13} />{k}</a>)}</div>}
        <dl className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-2 text-[13px]">
          {[["Total supply", t.supply !== null ? formatNumber(t.supply, 0) : "—"], ["Decimals", String(t.decimals)], ["Creator", t.creator ? `${t.creator.slice(0, 4)}…${t.creator.slice(-4)}` : "—"], ["Price", "No pool yet"]].map(([k, v]) => (
            <div key={k} className="rounded-xl bg-surface-2 px-3 py-2 min-w-0"><dt className="text-[11px] text-muted">{k}</dt><dd className="font-medium num truncate">{v}</dd></div>
          ))}
        </dl>
      </Card>
      <Notice title="Not trading yet">This token has no liquidity pool, so there&apos;s no price or chart yet. Once a pool is created, live price, trades and swaps appear here automatically.</Notice>
      <div className="flex flex-wrap gap-2">
        <Link href={`/launchpad/token/${chain}/${address}`} className="btn-ink h-11 px-4 rounded-full inline-flex items-center gap-2 text-[14px] font-semibold" data-testid="prepool-manage"><Settings2 size={15} /> Manage token</Link>
        <Link href={`/launchpad/token/${chain}/${address}#liquidity`} className="h-11 px-4 rounded-full bg-surface-2 hover:bg-surface-3 inline-flex items-center gap-2 text-[14px] font-medium"><Droplets size={15} /> Add liquidity</Link>
        <a href={`${EXPLORER[chain] ?? "https://solscan.io/token/"}${address}`} target="_blank" rel="noopener noreferrer" className="h-11 px-4 rounded-full bg-surface-2 hover:bg-surface-3 inline-flex items-center gap-2 text-[14px] font-medium">Explorer <ExternalLink size={13} /></a>
      </div>
    </div>
  );
}
