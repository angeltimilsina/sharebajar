/**
 * Public origin used for canonical URLs, the sitemap, robots and Open Graph.
 * Order: explicit NEXT_PUBLIC_SITE_URL → Vercel's production domain → localhost.
 */
export function siteUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (vercel) return `https://${vercel.replace(/^https?:\/\//, "").replace(/\/+$/, "")}`;
  return "http://localhost:3000";
}

export const absolute = (path: string) => `${siteUrl()}${path.startsWith("/") ? path : `/${path}`}`;
