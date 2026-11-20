"use client";
import Link from "next/link";
import {
  Activity, BarChart3, Bell, Bitcoin, Compass, Eye, Fingerprint, KeyRound, Layers, LineChart, Lock, Plug, Receipt,
  Repeat, Rocket, ShieldCheck, Sparkles, Star, Wallet,
} from "lucide-react";
import clsx from "clsx";
import { useWallet } from "../wallet/WalletProvider";
import { walletLogo } from "@/lib/logos";

/** iOS Settings-style icon tile: white glyph on a coloured rounded square. */
function Glyph({ icon: Icon, color }: { icon: typeof Wallet; color: string }) {
  return <span className="h-9 w-9 shrink-0 rounded-[10px] grid place-items-center text-white" style={{ background: color }}><Icon size={19} strokeWidth={2.2} /></span>;
}

const HOW = [
  { icon: Plug, color: "#0a84ff", title: "Connect, don't hand over", body: "Connect any supported wallet or the Bajar Wallet. Bajar only ever sees your public address — never your recovery phrase or keys." },
  { icon: Eye, color: "#30d158", title: "Read straight from the chain", body: "Balances come directly from Bitcoin, Ethereum, Solana and EVM network nodes, priced from live exchange and on-chain markets with the source shown." },
  { icon: Activity, color: "#ff9f0a", title: "Track every move", body: "Swaps and transfers you make on Bajar appear with pending → confirmed status, links to the explorer, and the asset page they came from." },
  { icon: KeyRound, color: "#bf5af2", title: "You approve everything", body: "Every swap, send and bridge needs your explicit approval in your own wallet, with fees disclosed before you sign." },
];

const WALLETS: { id: string; name: string }[] = [
  { id: "phantom", name: "Phantom" }, { id: "metamask", name: "MetaMask" }, { id: "solflare", name: "Solflare" }, { id: "backpack", name: "Backpack" },
  { id: "coinbase", name: "Coinbase Wallet" }, { id: "rabby", name: "Rabby" }, { id: "trust", name: "Trust Wallet" }, { id: "okx", name: "OKX Wallet" },
  { id: "rainbow", name: "Rainbow" }, { id: "zerion", name: "Zerion" },
];

const FEATURES: { icon: typeof Wallet; color: string; title: string; body: string; href: string }[] = [
  { icon: LineChart, color: "#0a84ff", title: "Live markets", body: "Prices, smart views and stat switching across every major network.", href: "/" },
  { icon: Compass, color: "#5e5ce6", title: "Discover", body: "Trending, new and high-volume on-chain pools with risk signals.", href: "/discover" },
  { icon: Repeat, color: "#30d158", title: "Trade & swap", body: "Best-route swaps on Solana and EVM chains with every fee shown.", href: "/trade" },
  { icon: Rocket, color: "#ff375f", title: "Launch a token", body: "Create a Solana token with metadata in one wallet-signed transaction.", href: "/launchpad" },
  { icon: Sparkles, color: "#bf5af2", title: "Bajar Intelligence", body: "Ask about any market; answers grounded in live data.", href: "/intelligence" },
  { icon: ShieldCheck, color: "#34c759", title: "Contract risk checks", body: "Honeypot, tax, holder and authority checks before you trade.", href: "/discover" },
  { icon: Bell, color: "#ff9f0a", title: "Price alerts", body: "Get notified when an asset crosses your price.", href: "/intelligence" },
  { icon: Star, color: "#ffd60a", title: "Watchlist", body: "Save coins and tokens on this device — no account needed.", href: "/" },
  { icon: Bitcoin, color: "#f7931a", title: "Native bitcoin", body: "Real BTC in the Bajar Wallet; wrapped BTC is always labelled as wrapped.", href: "/wallet" },
  { icon: BarChart3, color: "#64d2ff", title: "1-second charts", body: "Pro charts streaming live candles, order books and trades.", href: "/trade" },
  { icon: Receipt, color: "#8e8e93", title: "Transparent fees", body: "Platform and network fees shown before you approve — never hidden.", href: "/trade" },
  { icon: Layers, color: "#ac8e68", title: "Multi-chain", body: "Bitcoin, Ethereum, Solana, Base, BNB Chain, Polygon, Arbitrum and more.", href: "/" },
];

export function PortfolioIntro() {
  const { openModal } = useWallet();
  return (
    <div className="space-y-8 pb-4" data-testid="portfolio-intro">
      {/* Hero */}
      <section className="panel p-6 sm:p-8 overflow-hidden relative">
        <div className="absolute -right-16 -top-16 h-56 w-56 rounded-full opacity-25 blur-3xl" style={{ background: "radial-gradient(circle, #0a84ff, transparent 70%)" }} aria-hidden />
        <p className="text-[13px] font-semibold text-brand">Portfolio</p>
        <h1 className="text-[30px] sm:text-[40px] leading-[1.08] mt-1 max-w-[16ch]">All your crypto, one calm view.</h1>
        <p className="text-muted text-[15px] mt-3 max-w-xl leading-relaxed">Connect a wallet to see balances, value and activity across Bitcoin, Ethereum, Solana and EVM networks. Bajar never takes custody of your assets.</p>
        <div className="mt-6 flex flex-wrap gap-2.5">
          <button onClick={openModal} className="btn-ink h-[50px] px-6 rounded-full text-[17px] font-semibold inline-flex items-center gap-2" data-testid="portfolio-connect"><Wallet size={18} /> Connect wallet</button>
          <Link href="/wallet" className="h-[50px] px-6 rounded-full text-[17px] font-semibold inline-flex items-center gap-2 bg-surface-2 hover:bg-surface-3">Create a Bajar Wallet</Link>
        </div>
      </section>

      {/* How it works */}
      <section aria-labelledby="how">
        <h2 id="how" className="text-[22px] mb-3">How Bajar manages your portfolio</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {HOW.map((h) => (
            <div key={h.title} className="panel p-5 flex gap-3.5">
              <Glyph icon={h.icon} color={h.color} />
              <div><h3 className="font-semibold text-[16px]">{h.title}</h3><p className="text-[14px] text-muted mt-1 leading-relaxed">{h.body}</p></div>
            </div>
          ))}
        </div>
      </section>

      {/* Wallets */}
      <section aria-labelledby="wallets" className="panel p-5 sm:p-6">
        <div className="flex items-start gap-3.5">
          <Glyph icon={Wallet} color="#0a84ff" />
          <div>
            <h2 id="wallets" className="text-[20px]">Works with the wallets you use</h2>
            <p className="text-[14px] text-muted mt-1 max-w-2xl">Phantom, Solflare and Backpack on Solana, any EVM wallet that announces itself through EIP-6963 (MetaMask, Coinbase Wallet, Rabby, Trust, OKX, Rainbow, Zerion and more) — plus the Bajar Wallet for Bitcoin, Ethereum and Solana from one recovery phrase.</p>
          </div>
        </div>
        <ul className="mt-5 grid grid-cols-4 sm:grid-cols-6 lg:grid-cols-11 gap-3">
          <li className="flex flex-col items-center gap-1.5 text-center">
            <span className="h-12 w-12 rounded-[14px] bg-black grid place-items-center ring-1 ring-white/10" aria-hidden>
              <span className="grid gap-[3px]"><i className="block h-[4px] w-6 rounded bg-white" /><i className="block h-[4px] w-6 rounded bg-[#30d158]" /><i className="block h-[4px] w-6 rounded bg-white" /></span>
            </span>
            <span className="text-[11px] text-muted leading-tight">Bajar Wallet</span>
          </li>
          {WALLETS.map((w) => {
            const src = walletLogo(w.id);
            return (
              <li key={w.id} className="flex flex-col items-center gap-1.5 text-center">
                <span className="h-12 w-12 rounded-[14px] bg-surface-2 grid place-items-center overflow-hidden">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {src ? <img src={src} alt="" width={30} height={30} className="h-[30px] w-[30px] object-contain" loading="lazy" /> : <Wallet size={20} className="text-muted" />}
                </span>
                <span className="text-[11px] text-muted leading-tight">{w.name}</span>
              </li>
            );
          })}
        </ul>
      </section>

      {/* Post-quantum */}
      <section aria-labelledby="pq" className="panel p-5 sm:p-6 relative overflow-hidden">
        <div className="absolute -left-20 -bottom-24 h-64 w-64 rounded-full opacity-20 blur-3xl" style={{ background: "radial-gradient(circle, #bf5af2, transparent 70%)" }} aria-hidden />
        <div className="flex items-start gap-3.5 relative">
          <Glyph icon={Fingerprint} color="#bf5af2" />
          <div>
            <h2 id="pq" className="text-[20px]">Post-quantum signatures</h2>
            <p className="text-[14px] text-muted mt-1 max-w-2xl leading-relaxed">
              The Bajar Wallet pairs your classical keys with an <span className="text-fg font-medium">ML-DSA-65</span> identity (NIST FIPS 204). Sign-in, encrypted backups and authorization records carry both signatures, so they stay verifiable even against future quantum attacks.
            </p>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-3 mt-5 relative">
          {[
            { icon: Fingerprint, t: "Hybrid sign-in", b: "Server checks the classical and ML-DSA-65 signatures — both must pass." },
            { icon: Lock, t: "Signed backups", b: "Encrypted vault backups are signed, so tampering is detected on restore." },
            { icon: Receipt, t: "Authorization records", b: "Each approval you give is logged with a post-quantum signature." },
          ].map((x) => (
            <div key={x.t} className="rounded-2xl bg-surface-2 p-4">
              <x.icon size={18} className="text-[var(--ai)]" />
              <div className="font-semibold text-[15px] mt-2">{x.t}</div>
              <p className="text-[13px] text-muted mt-1 leading-relaxed">{x.b}</p>
            </div>
          ))}
        </div>
        <p className="text-[12px] text-faint mt-4 relative">Blockchain transactions themselves use each network&apos;s own signature scheme — Bitcoin, Ethereum and Solana don&apos;t support post-quantum transaction signatures today.</p>
      </section>

      {/* Everything */}
      <section aria-labelledby="all">
        <h2 id="all" className="text-[22px] mb-3">Everything in Bajar</h2>
        <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <Link key={f.title} href={f.href} className={clsx("panel p-4 flex gap-3.5 items-start hover:bg-surface-2/60 active:scale-[0.99] transition")}>
              <Glyph icon={f.icon} color={f.color} />
              <div className="min-w-0"><div className="font-semibold text-[15.5px]">{f.title}</div><p className="text-[13.5px] text-muted mt-0.5 leading-snug">{f.body}</p></div>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
