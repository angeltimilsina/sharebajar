import Link from "next/link";
import clsx from "clsx";

/** Bajar's mark: three rounded bars, red, green and blue. Morphs into a close icon on the menu button. */
export const LOGO_COLORS = { red: "#FF0000", green: "#00E833", blue: "#0057FF" };
export function LogoMark({ size = 28, open = false }: { size?: number; open?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden>
      <g className="transition-transform duration-200 origin-center" style={{ transformBox: "fill-box" }}>
        <rect x="6" y="8" width="28" height="7" rx="3.5" fill={LOGO_COLORS.red} className="transition-all duration-200" style={open ? { transform: "translate(0px, 8.5px) rotate(45deg)", transformOrigin: "20px 11.5px" } : undefined} />
        <rect x="6" y="16.5" width="28" height="7" rx="3.5" fill={LOGO_COLORS.green} className="transition-opacity duration-200" style={{ opacity: open ? 0 : 1 }} />
        <rect x="6" y="25" width="28" height="7" rx="3.5" fill={LOGO_COLORS.blue} className="transition-all duration-200" style={open ? { transform: "translate(0px, -8.5px) rotate(-45deg)", transformOrigin: "20px 28.5px" } : undefined} />
      </g>
    </svg>
  );
}

/**
 * The three-bar mark is the menu button (it morphs into a close icon when
 * open); the "Bajar" wordmark links home.
 */
export function Logo({ menuOpen, onMenu, connected, menuLabel = "Wallet panel" }: { menuOpen?: boolean; onMenu?: () => void; connected?: boolean; menuLabel?: string }) {
  return (
    <div className="flex items-center gap-1 shrink-0">
      {onMenu && (
        <button
          type="button"
          onClick={onMenu}
          aria-label={menuOpen ? "Close wallet panel" : connected ? `${menuLabel} (wallet connected)` : menuLabel}
          aria-expanded={menuOpen}
          data-testid="menu-button"
          className={clsx("relative -ml-1.5 h-10 w-10 grid place-items-center rounded-full text-fg transition-colors", menuOpen ? "bg-surface-2" : "hover:bg-surface-2")}
        >
          <LogoMark open={menuOpen} />
          {connected && !menuOpen && <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-accent ring-2 ring-[var(--bg)]" aria-hidden />}
        </button>
      )}
      <Link href="/" className="flex items-center gap-2" aria-label="Bajar home">
        {!onMenu && <span className="text-fg"><LogoMark /></span>}
        <span className="font-display text-[23px] leading-none tracking-tight text-fg">Bajar</span>
      </Link>
    </div>
  );
}
