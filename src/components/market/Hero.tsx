import Link from "next/link";
import { ArrowRight, ArrowUp, ShieldCheck, Sparkles, Zap } from "lucide-react";

const PROMPTS = ["Is SOL trending today?", "Find new Base tokens with real liquidity", "Explain this token's risks"];

export function Hero() {
  return (
    <section className="grid gap-4 lg:grid-cols-[1.25fr_1fr] rise">
      <div className="rounded-[22px] border border-line bg-surface p-5 sm:p-8 shadow-[var(--shadow)]">
        <p className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-3 py-1 text-xs text-muted">
          <span className="h-1.5 w-1.5 rounded-full bg-accent pulse-dot" /> Live across Bitcoin, Ethereum, Solana and more
        </p>
        <h1 className="mt-4 text-[30px] sm:text-[44px] text-fg max-w-[18ch]">
          Every market, one calm place.
        </h1>
        <p className="mt-3 text-[15px] sm:text-base text-muted max-w-xl leading-relaxed">
          Screen tokens on every major network, discover new launches with real liquidity, and trade from your own self-custody wallet.
        </p>
        <div className="mt-6 flex flex-wrap gap-2.5">
          <Link href="/discover" className="inline-flex items-center gap-2 h-11 px-5 rounded-2xl btn-ink text-[15px] font-medium">Explore markets <ArrowRight size={16} /></Link>
          <Link href="/trade" className="inline-flex items-center gap-2 h-11 px-5 rounded-2xl border border-line-strong bg-surface text-[15px] font-medium hover:bg-surface-2">Trade <Zap size={16} /></Link>
        </div>
        <ul className="mt-6 flex flex-wrap gap-x-5 gap-y-2 text-[13px] text-muted">
          <li className="inline-flex items-center gap-1.5"><ShieldCheck size={14} className="text-accent" /> Self-custody wallet</li>
          <li className="inline-flex items-center gap-1.5"><ShieldCheck size={14} className="text-accent" /> Real-time on-chain data</li>
          <li className="inline-flex items-center gap-1.5"><ShieldCheck size={14} className="text-accent" /> No account needed</li>
        </ul>
      </div>

      <div className="rounded-[22px] border border-line bg-surface p-6 sm:p-7 shadow-[var(--shadow)] flex flex-col">
        <div className="flex items-center gap-2.5">
          <span className="h-9 w-9 rounded-full grid place-items-center bg-ai/12 text-ai"><Sparkles size={17} /></span>
          <h2 className="text-[22px]">Bajar Intelligence</h2>
        </div>
        <p className="mt-2 text-sm text-muted">Ask about any token or market. Answers are grounded in live data.</p>
        <Link href="/intelligence" className="mt-5 group flex items-end gap-2 rounded-2xl border border-line-strong bg-bg px-4 py-3.5 hover:border-[color-mix(in_srgb,var(--text)_30%,transparent)] transition-colors" aria-label="Ask Bajar Intelligence">
          <span className="flex-1 text-[15px] text-faint">Ask anything about crypto markets…</span>
          <span className="h-8 w-8 shrink-0 rounded-full btn-ink grid place-items-center"><ArrowUp size={16} /></span>
        </Link>
        <div className="mt-3 flex flex-wrap gap-2">
          {PROMPTS.map((p) => (
            <Link key={p} href={`/intelligence?q=${encodeURIComponent(p)}`} className="rounded-full border border-line px-3 py-1.5 text-xs text-muted hover:text-fg hover:bg-surface-2">{p}</Link>
          ))}
        </div>
      </div>
    </section>
  );
}
