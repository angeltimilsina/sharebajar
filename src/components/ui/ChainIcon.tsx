import { getChain } from "@/lib/chains";
import clsx from "clsx";

/** Simple, original geometric marks per chain (colour-coded). */
export function ChainIcon({ chain, size = 16, className }: { chain: string; size?: number; className?: string }) {
  const c = getChain(chain);
  const color = c?.color ?? "#777";
  const s = size;
  let shape: React.ReactNode;
  switch (chain) {
    case "bitcoin":
      shape = <g><circle cx="9" cy="9" r="7.5" fill="#F7931A" /><text x="9" y="12.6" textAnchor="middle" fontSize="10" fontWeight="700" fill="#fff">₿</text></g>;
      break;
    case "solana":
      shape = (
        <g fill={color}>
          <path d="M5 6.5h9.5l-2 2H3z" /><path d="M5 11h9.5l-2-2H3z" opacity=".8" /><path d="M5 13.5h9.5l-2 2H3z" opacity=".9" />
        </g>
      );
      break;
    case "ethereum":
      shape = <g fill={color}><path d="M9 2l4.5 7.4L9 12 4.5 9.4z" /><path d="M9 13l4.5-2.7L9 16.5 4.5 10.3z" opacity=".7" /></g>;
      break;
    case "base":
      shape = <circle cx="9" cy="9" r="6.5" fill={color} />;
      break;
    case "bsc":
      shape = <g fill={color} transform="rotate(45 9 9)"><rect x="6.5" y="6.5" width="5" height="5" /><rect x="3" y="8" width="2" height="2" /><rect x="13" y="8" width="2" height="2" /><rect x="8" y="3" width="2" height="2" /><rect x="8" y="13" width="2" height="2" /></g>;
      break;
    case "polygon":
      shape = <path d="M9 2.5l5.6 3.25v6.5L9 15.5l-5.6-3.25v-6.5z" fill="none" stroke={color} strokeWidth="2" />;
      break;
    case "arbitrum":
      shape = <g><path d="M9 2l6 3.5v7L9 16l-6-3.5v-7z" fill="#213147" /><path d="M7 12l3-7 1.6 1-2.6 6z" fill={color} /></g>;
      break;
    case "avalanche":
      shape = <path d="M9 3l6.5 12h-13z" fill={color} />;
      break;
    case "optimism":
      shape = <circle cx="9" cy="9" r="6.5" fill={color} />;
      break;
    default:
      shape = <circle cx="9" cy="9" r="6" fill={color} />;
  }
  return (
    <svg width={s} height={s} viewBox="0 0 18 18" className={clsx("shrink-0", className)} aria-label={c?.name ?? (chain === "bitcoin" ? "Bitcoin" : chain)} role="img">
      {shape}
    </svg>
  );
}

export function ChainLabel({ chain, className }: { chain: string; className?: string }) {
  const c = getChain(chain);
  return (
    <span className={clsx("inline-flex items-center gap-1 text-xs text-muted", className)}>
      <ChainIcon chain={chain} size={13} />
      {c?.name ?? chain}
    </span>
  );
}
