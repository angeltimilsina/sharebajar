"use client";
import { useState } from "react";
import clsx from "clsx";
import { tokenLogo } from "@/lib/logos";

/** Icon URLs that failed once — skip them on later renders instead of re-requesting. */
const failedSrc = new Set<string>();

const PALETTE = ["#14F195", "#8A92B2", "#F3BA2F", "#8247E5", "#28A0F0", "#E84142", "#FF6B00", "#00C2FF"];

/**
 * `canonical` = a well-known asset (listed coin or known token contract): the
 * official self-hosted logo is used. Otherwise the token's own image is shown,
 * so look-alike tokens never borrow a famous logo.
 */
export function TokenIcon({ src: srcIn, symbol, size = 28, className, canonical = false }: { src?: string | null; symbol: string; size?: number; className?: string; canonical?: boolean }) {
  const src = (canonical ? tokenLogo(symbol) : null) ?? srcIn;
  const [failed, setFailed] = useState(() => !!src && failedSrc.has(src));
  const letters = (symbol || "?").replace(/^\$/, "").slice(0, 2).toUpperCase();
  const color = PALETTE[[...letters].reduce((s, c) => s + c.charCodeAt(0), 0) % PALETTE.length];
  if (src && !failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt=""
        width={size}
        height={size}
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => { failedSrc.add(src); setFailed(true); }}
        className={clsx("rounded-full shrink-0 bg-surface-3", src.endsWith(".svg") ? "object-contain" : "object-cover", className)}
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span
      aria-hidden
      className={clsx("rounded-full shrink-0 grid place-items-center font-bold", className)}
      style={{ width: size, height: size, fontSize: size * 0.36, background: `${color}22`, color }}
    >
      {letters}
    </span>
  );
}
