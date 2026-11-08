import Link from "next/link";
import { LogoMark } from "../ui/Logo";

export function Footer() {
  return (
    <footer className="border-t border-line mt-10">
      <div className="mx-auto max-w-[1680px] px-4 lg:px-6 py-8 grid gap-6 md:grid-cols-[1.4fr_1fr_1fr_1fr] text-sm">
        <div>
          <div className="flex items-center gap-2 font-bold"><LogoMark size={24} /> Bajar</div>
          <p className="text-xs text-muted mt-2 max-w-sm leading-relaxed">
            Open, multi-chain crypto marketplace. Market data from CoinLore, Binance, DexScreener, GeckoTerminal and DefiLlama; chain data straight from Bitcoin, Ethereum, Solana and EVM RPC nodes; contract checks by GoPlus; Solana routing by Jupiter.
            Nothing on Bajar is financial advice. Crypto assets are volatile and you can lose your entire investment.
          </p>
        </div>
        <div>
          <div className="text-xs font-semibold text-muted uppercase tracking-wider mb-2">Markets</div>
          <ul className="space-y-1.5 text-muted"><li><Link href="/" className="hover:text-fg">Market overview</Link></li><li><Link href="/discover" className="hover:text-fg">Token discovery</Link></li><li><Link href="/launchpad" className="hover:text-fg">New launches</Link></li></ul>
        </div>
        <div>
          <div className="text-xs font-semibold text-muted uppercase tracking-wider mb-2">Trade</div>
          <ul className="space-y-1.5 text-muted"><li><Link href="/trade" className="hover:text-fg">Swap</Link></li><li><Link href="/charts" className="hover:text-fg">Pro charts</Link></li><li><Link href="/portfolio" className="hover:text-fg">Portfolio</Link></li><li><Link href="/wallet" className="hover:text-fg">Bajar Wallet</Link></li></ul>
        </div>
        <div>
          <div className="text-xs font-semibold text-muted uppercase tracking-wider mb-2">Platform</div>
          <ul className="space-y-1.5 text-muted"><li><Link href="/intelligence" className="hover:text-fg">Bajar Intelligence</Link></li><li><Link href="/status" className="hover:text-fg">System status</Link></li></ul>
        </div>
      </div>
    </footer>
  );
}
