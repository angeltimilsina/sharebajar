import Link from "next/link";
import { ArrowRight, Zap, Sparkles } from "lucide-react";

function Globe() {
  // Dotted globe built from SVG — no external imagery.
  const dots: React.ReactNode[] = [];
  const R = 210;
  for (let lat = -80; lat <= 80; lat += 7) {
    const r = Math.cos((lat * Math.PI) / 180) * R;
    const y = Math.sin((lat * Math.PI) / 180) * R * -1;
    const count = Math.max(6, Math.floor((r / R) * 54));
    for (let i = 0; i < count; i++) {
      const lon = (i / count) * Math.PI * 2;
      const x = Math.sin(lon) * r;
      const z = Math.cos(lon);
      if (z < -0.05) continue;
      const land = Math.sin(lat * 0.11 + i * 0.7) + Math.cos(i * 0.37 - lat * 0.05) > 0.35;
      dots.push(<circle key={`${lat}-${i}`} cx={x} cy={y} r={land ? 1.9 : 1} fill="var(--brand)" opacity={(0.15 + z * 0.75) * (land ? 1 : 0.35)} />);
    }
  }
  return (
    <svg viewBox="-260 -230 520 300" className="w-full h-full" aria-hidden>
      <defs>
        <radialGradient id="g-glow" cx="50%" cy="60%" r="60%">
          <stop offset="0%" stopColor="var(--brand)" stopOpacity="0.28" />
          <stop offset="70%" stopColor="var(--brand)" stopOpacity="0.04" />
          <stop offset="100%" stopColor="var(--brand)" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx="0" cy="0" r="250" fill="url(#g-glow)" />
      <circle cx="0" cy="0" r={R} fill="none" stroke="var(--brand)" strokeOpacity="0.35" strokeWidth="1.2" />
      {dots}
      <circle cx="0" cy="-40" r="4" fill="#fff" />
      <circle cx="0" cy="-40" r="10" fill="var(--brand)" opacity="0.3" />
    </svg>
  );
}

export function Hero() {
  return (
    <section className="grid gap-4 lg:grid-cols-[1fr_minmax(0,460px)]">
      <div className="relative overflow-hidden rounded-2xl border border-line bg-surface min-h-[180px] lg:min-h-[176px]">
        <div className="absolute right-[-60px] top-[-10px] w-[560px] h-[300px] opacity-90 pointer-events-none hidden md:block"><Globe /></div>
        <div className="relative p-5 lg:p-6 max-w-2xl">
          <h1 className="text-[28px] sm:text-[34px] font-bold tracking-tight leading-tight">
            The Open <span className="text-brand drop-shadow-[0_0_18px_var(--brand-soft)]">Crypto</span> Marketplace
          </h1>
          <p className="mt-2 text-[15px] text-muted max-w-xl">Discover tokens, analyze markets, and trade across multiple blockchains — all in one place.</p>
          <div className="mt-4 flex flex-wrap gap-3">
            <Link href="/discover" className="inline-flex items-center gap-2 h-11 px-5 rounded-xl bg-brand text-brand-ink font-semibold hover:bg-brand-strong shadow-[0_0_24px_-6px_var(--brand)]">Explore Markets <ArrowRight size={16} /></Link>
            <Link href="/trade" className="inline-flex items-center gap-2 h-11 px-5 rounded-xl border border-brand/60 font-semibold hover:bg-brand-soft">Trade Now <Zap size={16} /></Link>
          </div>
        </div>
      </div>
      <div className="relative overflow-hidden rounded-2xl border border-line bg-surface p-5">
        <svg className="absolute right-0 bottom-0 w-[70%] h-full opacity-80 pointer-events-none" viewBox="0 0 300 160" preserveAspectRatio="none" aria-hidden>
          <defs>
            <linearGradient id="ai-wave" x1="0" x2="1"><stop offset="0%" stopColor="var(--brand)" stopOpacity="0.0" /><stop offset="50%" stopColor="var(--brand)" stopOpacity="0.55" /><stop offset="100%" stopColor="var(--ai)" stopOpacity="0.9" /></linearGradient>
          </defs>
          {[0, 8, 16, 24, 32].map((o) => (
            <path key={o} d={`M0,${150 - o} C80,${150 - o} 120,${110 - o} 180,${80 - o} S260,${20 - o / 2} 300,${10 + o / 3}`} fill="none" stroke="url(#ai-wave)" strokeWidth="1.4" opacity={1 - o / 45} />
          ))}
        </svg>
        <div className="relative">
          <div className="flex items-center gap-2.5">
            <span className="h-9 w-9 rounded-xl grid place-items-center bg-brand-soft text-brand font-bold text-sm border border-brand/30">AI</span>
            <h2 className="text-lg font-semibold">ShareBajar Intelligence</h2>
          </div>
          <p className="mt-2 text-sm text-muted max-w-[300px]">AI-powered market analysis, token insights, and real-time alerts — grounded in live market data.</p>
          <Link href="/intelligence" className="mt-4 inline-flex items-center gap-2 h-10 px-5 rounded-xl bg-brand text-brand-ink font-semibold text-sm hover:bg-brand-strong"><Sparkles size={15} /> Ask AI <ArrowRight size={15} /></Link>
        </div>
      </div>
    </section>
  );
}
