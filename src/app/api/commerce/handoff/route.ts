import { z } from "zod";
import { NextResponse } from "next/server";
import { defaultAddress, getShoppingProfile, shopifyPrefillUrl } from "@/lib/commerce/profile";
import { shopifyStores } from "@/lib/commerce/registry";
import { currentSession, profileForSession } from "@/lib/pro/profile";
import { crossSiteRejection } from "@/lib/server/guard";
import { clientIp, rateLimit } from "@/lib/server/ratelimit";
import { fetchUpstream } from "@/lib/server/http";

const Body = z.object({ url: z.string().url().max(500), quantity: z.number().int().min(1).max(10), addressId: z.string().max(20).optional() });

/**
 * Builds a Shopify checkout link with the customer's saved details filled in.
 * Only for allowlisted stores; the customer confirmed what is shared before calling this.
 */
export async function POST(req: Request) {
  const blocked = crossSiteRejection(req);
  if (blocked) return blocked;
  const rl = rateLimit(`ho:${clientIp(req)}`, 20, 20);
  if (!rl.ok) return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  const p = Body.safeParse(await req.json().catch(() => null));
  if (!p.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const u = new URL(p.data.url);
  const store = shopifyStores().find((s) => s.domain === u.hostname);
  const handle = /^\/products\/([a-z0-9][a-z0-9-]{0,200})\/?$/i.exec(u.pathname)?.[1];
  if (u.protocol !== "https:" || !store || !handle) return NextResponse.json({ error: "Prefilled checkout is only available for supported Shopify stores." }, { status: 400 });
  const s = await currentSession().catch(() => null);
  if (!s) return NextResponse.json({ error: "Sign in with your wallet to use your saved details." }, { status: 401 });
  try {
    const profile = await getShoppingProfile(await profileForSession(s));
    const address = profile.addresses.find((a) => a.id === p.data.addressId) ?? defaultAddress(profile);
    const product = await fetchUpstream<{ variants?: { id: number; available: boolean }[] }>(`https://${store.domain}/products/${handle}.js`, { timeoutMs: 7000, retries: 1 });
    const variant = product.variants?.find((v) => v.available) ?? null;
    if (!variant) return NextResponse.json({ error: "This item is out of stock at the store." }, { status: 409 });
    return NextResponse.json({ url: shopifyPrefillUrl(store.domain, variant.id, p.data.quantity, profile, address), store: store.name }, { headers: { "cache-control": "no-store" } });
  } catch {
    return NextResponse.json({ error: `Couldn't reach ${store.name}. Open the product page instead.` }, { status: 502 });
  }
}
