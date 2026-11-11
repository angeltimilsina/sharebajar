import "server-only";
import { q, newId } from "@/lib/treasury/db";
import { canonical, decrypt, encrypt, sha256 } from "@/lib/treasury/crypto";
import { seal, unseal, verifyEvm, verifySolana } from "@/lib/server/auth";
import type { Offer } from "./types";
import { retailerById } from "./registry";
import { SANDBOX_FAIL_ID, SANDBOX_SHIPPING, sandboxItem } from "./providers/sandbox";
import { cryptoQuote, PAY_ASSETS, type PayAsset } from "./cryptoQuote";

/**
 * BAJAR Pay. Flow: quote → itemized fees → review → the customer signs the
 * exact quote in their own wallet → payment through a supported provider →
 * merchant confirmation → receipt and tracking.
 *
 * Only the sandbox provider exists today (BAJAR_PAY_PROVIDER is not set), so
 * every order is a clearly labeled test: no funds move and nothing ships. With
 * no real provider configured, real merchants get an external checkout link —
 * a sandbox result is never presented as a real purchase.
 *
 * Accounting keeps three amounts apart on every order: what the customer pays,
 * what the merchant is settled, and BAJAR's own fees/commission.
 */

export const QUOTE_TTL_MS = 10 * 60_000;
export const feeBps = () => clampInt(process.env.BAJAR_PAY_FEE_BPS, 50, 0, 300);              // disclosed customer fee (0.5% default)
export const commissionBps = () => clampInt(process.env.MERCHANT_COMMISSION_BPS, 300, 0, 2000); // paid by the merchant, not the customer
export const maxOrderUsd = () => clampInt(process.env.BAJAR_PAY_MAX_ORDER_USD, 2500, 1, 1_000_000);
/** Orders allowed per connection per hour (fraud control). */
export const ipOrdersPerHour = () => clampInt(process.env.COMMERCE_IP_ORDERS_PER_HOUR, 10, 1, 10_000);
export const SANDBOX_DAILY_USD = 1000;   // sandbox test funds per wallet per day (no real money)
export const realProvider = () => process.env.BAJAR_PAY_PROVIDER || null;

function clampInt(v: string | undefined, d: number, lo: number, hi: number) {
  const n = Number(v);
  return Number.isFinite(n) && v !== undefined && v !== "" ? Math.min(hi, Math.max(lo, Math.round(n))) : d;
}
const cents = (n: number) => Math.round(n * 100) / 100;

export interface QuoteInput { offerId: string; quantity: number; shippingId?: string; asset: PayAsset; network?: string; wallet: string; chainType: "solana" | "evm"; plus?: boolean; host: string }
export interface QuoteLine { label: string; usd: number; note?: string }
export interface Quote {
  id: string; sandbox: boolean; offer: Pick<Offer, "id" | "title" | "merchant" | "retailer" | "price" | "image">; quantity: number;
  shipping: { id: string; label: string; usd: number; days: readonly number[] };
  lines: QuoteLine[]; totalUsd: number; merchantSettlementUsd: number; bajarFeeUsd: number; commissionUsd: number;
  asset: PayAsset; network: string; cryptoAmount: number; priceUsd: number; priceSource: string; networkFeeUsd: number;
  wallet: string; chainType: "solana" | "evm"; expiresAt: number; message: string; hash: string;
}

export class PayError extends Error { constructor(public code: string, message: string, public status = 400) { super(message); } }

const NETWORK_FOR: Record<"solana" | "evm", string[]> = { solana: ["solana"], evm: ["ethereum", "base"] };

/** Builds an itemized, expiring quote. Only merchants with a BAJAR Pay integration can be quoted. */
export async function createQuote(i: QuoteInput): Promise<Quote> {
  const offer = i.offerId.startsWith("bajar-sandbox:") ? sandboxItem(i.offerId.split(":")[1]) : null;
  if (!offer) {
    const provider = realProvider();
    throw new PayError("external_checkout", provider ? "This merchant isn't connected to BAJAR Pay yet. Use the merchant's checkout." : "BAJAR Pay can't buy from this merchant yet. Use the merchant's own checkout.", 409);
  }
  if (!offer.inStock || offer.price === null) throw new PayError("unavailable", "This item isn't available right now.", 409);
  const qty = Math.trunc(i.quantity);
  if (!(qty >= 1 && qty <= 5)) throw new PayError("quantity", "Quantity must be 1–5.");
  const a = PAY_ASSETS[i.asset];
  if (!a) throw new PayError("asset", "Unsupported payment asset.");
  if (i.asset === "BTC") throw new PayError("asset", "BTC checkout isn't available yet: BAJAR Pay can't verify a Bitcoin wallet authorization. Pay with USDC, USDT, ETH or SOL.");
  const allowed = (a.networks as readonly string[]).filter((n) => NETWORK_FOR[i.chainType].includes(n));
  if (!allowed.length) throw new PayError("network", `${i.asset} can't be paid from a ${i.chainType === "solana" ? "Solana" : "EVM"} wallet. Pick ${i.chainType === "solana" ? "USDC, USDT or SOL" : "USDC, USDT or ETH"}.`);
  const network = i.network && allowed.includes(i.network) ? i.network : allowed[0];
  const ship = SANDBOX_SHIPPING.find((s) => s.id === (i.shippingId ?? "std")) ?? SANDBOX_SHIPPING[0];

  const subtotal = cents(offer.price * qty);
  const tax = cents((offer.tax ?? 0) * qty);
  const merchantGross = cents(subtotal + ship.usd + tax);
  const bajarFee = i.plus ? 0 : cents(merchantGross * feeBps() / 10_000);
  const total = cents(merchantGross + bajarFee);
  if (total > maxOrderUsd()) throw new PayError("limit", `Orders are limited to $${maxOrderUsd().toLocaleString("en-US")} each.`, 422);
  const commission = cents(subtotal * commissionBps() / 10_000);
  const cq = await cryptoQuote(total, i.asset, network);

  const lines: QuoteLine[] = [
    { label: `Item × ${qty}`, usd: subtotal },
    { label: `Shipping · ${ship.label}`, usd: ship.usd },
    { label: "Tax", usd: tax, note: "Test merchant charges no tax" },
    { label: i.plus ? "BAJAR Pay fee (waived for Plus)" : `BAJAR Pay fee (${(feeBps() / 100).toFixed(2)}%)`, usd: bajarFee },
  ];
  const id = newId("q");
  const expiresAt = Date.now() + QUOTE_TTL_MS;
  const core = { id, offerId: offer.id, title: offer.title, merchant: offer.merchant, qty, ship: ship.id, total, asset: i.asset, network, amount: cq.amount, wallet: i.wallet, expiresAt, sandbox: true };
  const hash = sha256(canonical(core));
  const message = [
    "BAJAR Pay — authorize payment",
    `Merchant: ${offer.merchant} (SANDBOX — no money moves)`,
    `Item: ${offer.title} × ${qty}`,
    `Total: $${total.toFixed(2)} = ${cq.amount} ${i.asset} on ${network}`,
    `Includes BAJAR Pay fee: $${bajarFee.toFixed(2)}`,
    `Quote: ${id}`,
    `Quote hash: ${hash}`,
    `Expires: ${new Date(expiresAt).toISOString()}`,
    `Domain: ${i.host}`,
    "I authorize this payment. Bajar agents cannot pay on my behalf.",
  ].join("\n");
  const quote: Quote = {
    id, sandbox: true, offer: { id: offer.id, title: offer.title, merchant: offer.merchant, retailer: offer.retailer, price: offer.price, image: offer.image },
    quantity: qty, shipping: { id: ship.id, label: ship.label, usd: ship.usd, days: ship.days }, lines, totalUsd: total,
    merchantSettlementUsd: cents(merchantGross - commission), bajarFeeUsd: bajarFee, commissionUsd: commission,
    asset: i.asset, network, cryptoAmount: cq.amount, priceUsd: cq.priceUsd, priceSource: cq.priceSource, networkFeeUsd: cq.networkFeeUsd,
    wallet: i.wallet, chainType: i.chainType, expiresAt, message, hash,
  };
  await q("insert into commerce_quotes (id, offer_id, wallet, chain_type, payload, hash, message, sandbox, expires_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
    [id, offer.id, i.wallet, i.chainType, JSON.stringify(quote), hash, message, true, new Date(expiresAt).toISOString()]);
  return quote;
}

export interface Shipping { name: string; line1: string; line2?: string; city: string; region?: string; postal: string; country: string; email?: string }
export interface OrderEvent { at: number; status: string; note: string }
/** Full purchase record kept with each order (encrypted at rest), shown to its owner. */
export interface Receipt {
  lines: QuoteLine[]; shipping: string; shipTo: Shipping | null; billTo: Shipping | null; paidWith: string; priceUsd: number; priceSource: string;
  networkFeeUsd: number; quoteHash: string; signature: string; authorizedBy: string; merchantSettlementUsd: number; agentPrepared: boolean;
}
export interface OrderView {
  receipt?: Receipt;
  id: string; sandbox: boolean; status: string; title: string; merchant: string; quantity: number; asset: string; network: string; cryptoAmount: string;
  totalUsd: number; refundedUsd: number; createdAt: string; events: OrderEvent[]; token?: string; shipTo?: string;
}

export interface AuthorizeInput { quoteId: string; signature: string; idempotencyKey: string; shipping: Shipping; billing?: Shipping | null; consent: boolean; ipHash: string; profileId?: string | null; profileWallet?: string | null; agentPrepared?: boolean }

/**
 * Verifies the customer's wallet signature over the exact quote, then runs
 * the payment through the provider. Idempotent per idempotency key.
 */
export async function authorizeOrder(i: AuthorizeInput): Promise<OrderView> {
  const existing = (await q<OrderRow>("select * from commerce_orders where idempotency_key=$1", [i.idempotencyKey]))[0];
  if (existing) {
    if (existing.quote_id !== i.quoteId) throw new PayError("idempotency", "This request id was already used for a different order.", 409);
    return view(existing, true);
  }
  if (!i.consent) throw new PayError("consent", "Confirm the order details before paying.");
  const row = (await q<{ payload: string; message: string; wallet: string; chain_type: "solana" | "evm"; expires_at: string | Date; used_order_id: string | null }>("select payload, message, wallet, chain_type, expires_at, used_order_id from commerce_quotes where id=$1", [i.quoteId]))[0];
  if (!row) throw new PayError("quote", "Quote not found. Get a new quote.", 404);
  if (row.used_order_id) throw new PayError("quote_used", "This quote was already used.", 409);
  if (new Date(row.expires_at).getTime() < Date.now()) throw new PayError("quote_expired", "This quote expired. Prices can change — get a new quote.", 410);
  const ok = row.chain_type === "solana" ? verifySolana(row.message, i.signature, row.wallet) : verifyEvm(row.message, i.signature, row.wallet);
  if (!ok) throw new PayError("signature", "The wallet authorization didn't match this quote. Nothing was charged.", 401);
  const quote = JSON.parse(row.payload) as Quote;

  // Fraud and limit checks.
  const risk: string[] = [];
  const recent = await q<{ n: string | number; usd: string | number | null }>("select count(*) as n, sum(customer_total_usd) as usd from commerce_orders where wallet=$1 and created_at > now() - interval '24 hours' and status not in ('merchant_failed','refunded','cancelled')", [row.wallet]);
  const ipRecent = await q<{ n: string | number }>("select count(*) as n from commerce_orders where ip_hash=$1 and created_at > now() - interval '1 hour'", [i.ipHash]);
  if (Number(ipRecent[0]?.n ?? 0) >= ipOrdersPerHour()) throw new PayError("velocity", "Too many orders from this connection. Try again later.", 429);
  if (Number(recent[0]?.n ?? 0) >= 5) risk.push("5+ orders from this wallet in 24 h");
  const spent = Number(recent[0]?.usd ?? 0);
  if (quote.sandbox && spent + quote.totalUsd > SANDBOX_DAILY_USD) {
    throw new PayError("insufficient_funds", `Insufficient sandbox test funds: $${(SANDBOX_DAILY_USD - spent).toFixed(2)} left today, order is $${quote.totalUsd.toFixed(2)}.`, 402);
  }
  if (!quote.sandbox) throw new PayError("provider", "No live payment provider is configured. Nothing was charged.", 501);
  const ship = cleanShipping(i.shipping);
  const bill = i.billing ? cleanShipping(i.billing) : null;
  const receipt: Receipt = {
    lines: quote.lines, shipping: quote.shipping.label, shipTo: ship, billTo: bill ?? ship, paidWith: `${quote.cryptoAmount} ${quote.asset} on ${quote.network}`,
    priceUsd: quote.priceUsd, priceSource: quote.priceSource, networkFeeUsd: quote.networkFeeUsd, quoteHash: quote.hash, signature: i.signature, authorizedBy: row.wallet,
    merchantSettlementUsd: quote.merchantSettlementUsd, agentPrepared: !!i.agentPrepared,
  };

  const id = newId("ord");
  const now = Date.now();
  const events: OrderEvent[] = [{ at: now, status: "authorized", note: "You authorized the payment in your wallet (sandbox: no funds moved)." }];
  // Claim the quote atomically: one order per quote, even with concurrent requests.
  const claimed = await q("update commerce_quotes set used_order_id=$1 where id=$2 and used_order_id is null returning id", [id, i.quoteId]);
  if (!claimed.length) throw new PayError("quote_used", "This quote was already used.", 409);

  // Sandbox provider: confirm with the test merchant.
  const merchantOk = !quote.offer.id.endsWith(`:${SANDBOX_FAIL_ID}`);
  let status: string;
  if (merchantOk) {
    status = "confirmed";
    events.push({ at: now, status: "confirmed", note: `${quote.offer.merchant} confirmed the order (sandbox).` });
  } else {
    status = "merchant_failed";
    events.push({ at: now, status: "merchant_failed", note: "The merchant didn't confirm the order. The authorization was released — nothing was charged." });
  }
  try {
    await q(`insert into commerce_orders (id, idempotency_key, quote_id, wallet, chain_type, sandbox, status, title, merchant, retailer, quantity, asset, network, crypto_amount,
      customer_total_usd, merchant_settlement_usd, bajar_fee_usd, commission_usd, network_fee_usd, signature, shipping_enc, risk, events, ip_hash, details_enc, profile_id)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26)`,
      [id, i.idempotencyKey, i.quoteId, row.wallet, row.chain_type, true, status, quote.offer.title, quote.offer.merchant, quote.offer.retailer, quote.quantity, quote.asset, quote.network, String(quote.cryptoAmount),
        quote.totalUsd, quote.merchantSettlementUsd, quote.bajarFeeUsd, quote.commissionUsd, quote.networkFeeUsd, i.signature, encrypt(ship), JSON.stringify(risk), JSON.stringify(events), i.ipHash, encrypt(receipt), i.profileId && i.profileWallet === row.wallet ? i.profileId : null]);
  } catch (e) {
    // Same idempotency key raced us: return that order.
    const again = (await q<OrderRow>("select * from commerce_orders where idempotency_key=$1", [i.idempotencyKey]))[0];
    if (again) return view(again, true);
    await q("update commerce_quotes set used_order_id=null where id=$1 and used_order_id=$2", [i.quoteId, id]).catch(() => {});
    throw e;
  }
  const created = (await q<OrderRow>("select * from commerce_orders where id=$1", [id]))[0];
  return view(created, true);
}

function cleanShipping(s: Shipping): Shipping {
  const t = (v: unknown, n: number) => (typeof v === "string" ? v.replace(/[\u0000-\u001f]/g, "").trim().slice(0, n) : "");
  const out: Shipping = { name: t(s?.name, 80), line1: t(s?.line1, 120), line2: t(s?.line2, 120) || undefined, city: t(s?.city, 60), region: t(s?.region, 60) || undefined, postal: t(s?.postal, 20), country: t(s?.country, 2).toUpperCase(), email: t(s?.email, 120) || undefined };
  if (!out.name || !out.line1 || !out.city || !out.postal || !/^[A-Z]{2}$/.test(out.country)) throw new PayError("shipping", "Add a full shipping address (name, street, city, postal code, 2-letter country).");
  if (out.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(out.email)) throw new PayError("shipping", "That email doesn't look right.");
  return out;
}

interface OrderRow {
  id: string; idempotency_key: string; quote_id: string; wallet: string; chain_type: string; sandbox: boolean; status: string; title: string; merchant: string; retailer: string;
  quantity: number; asset: string; network: string; crypto_amount: string; customer_total_usd: string | number; merchant_settlement_usd: string | number; bajar_fee_usd: string | number;
  commission_usd: string | number; network_fee_usd: string | number; refunded_usd: string | number; signature: string; shipping_enc: string | null; risk: string | null; events: string; created_at: string | Date;
  details_enc?: string | null; profile_id?: string | null;
}

/** Sandbox fulfilment timeline (simulated, labeled): ships 2 min after confirmation, delivered after 5. */
function progressed(r: OrderRow): { status: string; events: OrderEvent[] } {
  const events = JSON.parse(r.events) as OrderEvent[];
  if (!r.sandbox || r.status !== "confirmed") return { status: r.status, events };
  const conf = events.find((e) => e.status === "confirmed")?.at ?? Date.now();
  const out = [...events];
  let status = "confirmed";
  if (Date.now() - conf > 2 * 60_000) { status = "shipped"; out.push({ at: conf + 2 * 60_000, status, note: "Shipped (sandbox simulation — nothing actually ships)." }); }
  if (Date.now() - conf > 5 * 60_000) { status = "delivered"; out.push({ at: conf + 5 * 60_000, status, note: "Delivered (sandbox simulation)." }); }
  return { status, events: out };
}

export const orderToken = (id: string) => seal({ order: id, exp: Date.now() + 365 * 86400_000 }, "order");
const tokenOrder = (t: string) => unseal<{ order?: string }>(t, "order")?.order ?? null;

function view(r: OrderRow, withToken = false): OrderView {
  const p = progressed(r);
  let shipTo: string | undefined;
  let receipt: Receipt | undefined;
  if (withToken) { try { receipt = decrypt<Receipt>(r.details_enc) ?? undefined; } catch { /* key rotated */ } }
  try { const s = decrypt<Shipping>(r.shipping_enc); if (s) shipTo = `${s.name.split(" ")[0]} · ${s.city}, ${s.country}`; } catch { /* key rotated */ }
  return {
    id: r.id, sandbox: r.sandbox, status: p.status, title: r.title, merchant: r.merchant, quantity: r.quantity, asset: r.asset, network: r.network, cryptoAmount: r.crypto_amount,
    totalUsd: Number(r.customer_total_usd), refundedUsd: Number(r.refunded_usd), createdAt: new Date(r.created_at).toISOString(), events: p.events, shipTo, ...(withToken ? { token: orderToken(r.id), receipt } : {}),
  };
}

/** Orders for a signed-in wallet and/or the order receipts this browser holds. */
export async function ordersFor(opts: { wallet?: string | null; tokens?: string[]; profileId?: string | null }): Promise<OrderView[]> {
  const ids = (opts.tokens ?? []).slice(0, 50).map(tokenOrder).filter((x): x is string => !!x);
  if (!opts.wallet && !opts.profileId && !ids.length) return [];
  // The signed-in wallet's orders, every order of its Bajar profile (any linked wallet), and receipts held on this device.
  const rows = await q<OrderRow>("select * from commerce_orders where id = any($1) or ($2::text is not null and wallet=$2) or ($3::text is not null and profile_id=$3) order by created_at desc limit 100", [ids, opts.wallet ?? null, opts.profileId ?? null]);
  return rows.map((r) => view(r, true));
}
/** Back-compat for the #Track agent. */
export const ordersForWallet = (wallet: string) => ordersFor({ wallet });

/** Cancel before shipment → refund. In sandbox the refund is recorded; no funds move either way. */
export async function cancelOrder(token: string, reason: string): Promise<OrderView> {
  const id = tokenOrder(token);
  if (!id) throw new PayError("token", "Order not found.", 404);
  const r = (await q<OrderRow>("select * from commerce_orders where id=$1", [id]))[0];
  if (!r) throw new PayError("token", "Order not found.", 404);
  const p = progressed(r);
  if (p.status === "refunded" || p.status === "cancelled") return view(r, true);
  if (p.status === "merchant_failed") throw new PayError("state", "This order was never charged.", 409);
  if (p.status !== "confirmed" && p.status !== "authorized") throw new PayError("state", p.status === "shipped" ? "This order already shipped. Start a return with the merchant once it arrives." : "This order can't be cancelled now.", 409);
  const now = Date.now();
  const events = [...p.events, { at: now, status: "cancelled", note: `Cancelled${reason ? `: ${reason.slice(0, 120)}` : ""}.` }, { at: now, status: "refunded", note: `Refund of $${Number(r.customer_total_usd).toFixed(2)} recorded (sandbox: no funds moved).` }];
  const upd = await q<OrderRow>("update commerce_orders set status='refunded', refunded_usd=customer_total_usd, events=$2, updated_at=now() where id=$1 and status in ('confirmed','authorized') returning *", [id, JSON.stringify(events)]);
  return view(upd[0] ?? (await q<OrderRow>("select * from commerce_orders where id=$1", [id]))[0], true);
}

/** Internal commerce revenue (admin). Sandbox and live are reported separately. */
export async function commerceRevenue() {
  const rows = await q<{ sandbox: boolean; orders: string | number; gmv: string | number | null; fees: string | number | null; commissions: string | number | null; refunds: string | number | null; settlement: string | number | null; failed: string | number }>(`
    select sandbox,
      count(*) filter (where status <> 'merchant_failed') as orders,
      sum(customer_total_usd) filter (where status <> 'merchant_failed') as gmv,
      sum(bajar_fee_usd) filter (where status not in ('merchant_failed','refunded')) as fees,
      sum(commission_usd) filter (where status not in ('merchant_failed','refunded')) as commissions,
      sum(refunded_usd) as refunds,
      sum(merchant_settlement_usd) filter (where status not in ('merchant_failed','refunded')) as settlement,
      count(*) filter (where status = 'merchant_failed') as failed
    from commerce_orders group by sandbox`);
  const pick = (sb: boolean) => {
    const r = rows.find((x) => x.sandbox === sb);
    const n = (v: unknown) => Number(v ?? 0);
    const fees = n(r?.fees), commissions = n(r?.commissions);
    return { orders: n(r?.orders), gmv: n(r?.gmv), bajarFees: fees, commissions, refunds: n(r?.refunds), merchantSettlement: n(r?.settlement), failed: n(r?.failed), net: cents(fees + commissions) };
  };
  return { live: pick(false), sandbox: pick(true), feeBps: feeBps(), commissionBps: commissionBps(), provider: realProvider() };
}

export const checkoutModeFor = (o: Pick<Offer, "retailer">) => {
  const r = retailerById(o.retailer);
  return r.checkout === "bajar_pay_sandbox" ? "bajar_pay_sandbox" as const : r.checkout === "bajar_pay" && realProvider() ? "bajar_pay" as const : "external" as const;
};
