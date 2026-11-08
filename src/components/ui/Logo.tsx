import Link from "next/link";
import clsx from "clsx";

/** Three bars: ink, green signal, ink. Doubles as the menu icon on smaller screens. */
export function LogoMark({ size = 28, open = false }: { size?: number; open?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden>
      <g className="transition-transform duration-200 origin-center" style={{ transformBox: "fill-box" }}>
        <rect x="7" y="9" width="26" height="5.5" rx="2.75" fill="currentColor" className="transition-all duration-200" style={open ? { transform: "translate(0px, 8.25px) rotate(45deg)", transformOrigin: "20px 11.75px" } : undefined} />
        <rect x="7" y="17.25" width="26" height="5.5" rx="2.75" fill="var(--accent)" className="transition-opacity duration-200" style={{ opacity: open ? 0 : 1 }} />
        <rect x="7" y="25.5" width="26" height="5.5" rx="2.75" fill="currentColor" className="transition-all duration-200" style={open ? { transform: "translate(0px, -8.25px) rotate(-45deg)", transformOrigin: "20px 28.25px" } : undefined} />
      </g>
    </svg>
  );
}

/**
 * The three-bar mark is the menu button (it morphs into a close icon when
 * open); the "Bajar" wordmark links home.
 */
export function Logo({ menuOpen, onMenu }: { menuOpen?: boolean; onMenu?: () => void }) {
  return (
    <div className="flex items-center gap-1 shrink-0">
      {onMenu && (
        <button
          type="button"
          onClick={onMenu}
          aria-label={menuOpen ? "Close menu" : "Open menu"}
          aria-expanded={menuOpen}
          className={clsx("-ml-1.5 h-10 w-10 grid place-items-center rounded-full text-fg transition-colors", menuOpen ? "bg-surface-2" : "hover:bg-surface-2")}
        >
          <LogoMark open={menuOpen} />
        </button>
      )}
      <Link href="/" className="flex items-center gap-2" aria-label="Bajar home">
        {!onMenu && <span className="text-fg"><LogoMark /></span>}
        <span className="font-display text-[23px] leading-none tracking-tight text-fg">Bajar</span>
      </Link>
    </div>
  );
}
