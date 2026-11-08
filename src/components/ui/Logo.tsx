import Link from "next/link";

/** Three bars: ink, green signal, ink. */
export function LogoMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden>
      <rect x="7" y="9" width="26" height="5.5" rx="2.75" fill="currentColor" />
      <rect x="7" y="17.25" width="26" height="5.5" rx="2.75" fill="var(--accent)" />
      <rect x="7" y="25.5" width="26" height="5.5" rx="2.75" fill="currentColor" />
    </svg>
  );
}

export function Logo() {
  return (
    <Link href="/" className="flex items-center gap-2 shrink-0" aria-label="Bajar home">
      <span className="text-fg"><LogoMark /></span>
      <span className="font-display text-[23px] leading-none tracking-tight text-fg">Bajar</span>
    </Link>
  );
}
