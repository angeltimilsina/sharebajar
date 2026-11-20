import clsx from "clsx";
import { exchangeLogo } from "@/lib/logos";

/** Official logo for an exchange / DEX by name, or nothing if we don't have one. */
export function InstitutionLogo({ name, size = 16, className }: { name: string | null | undefined; size?: number; className?: string }) {
  const src = exchangeLogo(name);
  if (!src) return null;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt="" width={size} height={size} loading="lazy" decoding="async" className={clsx("inline-block shrink-0 rounded-full align-[-3px]", className)} style={{ width: size, height: size }} />;
}
