import Link from "next/link";

export function LogoMark({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden>
      <defs>
        <filter id="sb-glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="1.6" result="b" />
          <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>
      <g filter="url(#sb-glow)">
        <rect x="7" y="9" width="26" height="5.5" rx="1.2" fill="currentColor" />
        <rect x="7" y="17.25" width="26" height="5.5" rx="1.2" fill="var(--accent)" />
        <rect x="7" y="25.5" width="26" height="5.5" rx="1.2" fill="currentColor" />
      </g>
    </svg>
  );
}

export function Logo() {
  return (
    <Link href="/" className="flex items-center gap-2.5 shrink-0" aria-label="Bajar home">
      <span className="text-fg"><LogoMark /></span>
      <span className="text-[20px] font-bold tracking-tight leading-none text-silver">Bajar</span>
    </Link>
  );
}
