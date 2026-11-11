"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import clsx from "clsx";
import { ArrowUp, BadgeCheck, ExternalLink, Link2, Loader2, Package, ShieldAlert, Sparkles, Wallet } from "lucide-react";
import { AGENTS, type AgentId, type Offer } from "@/lib/commerce/types";
import { parseProductLink } from "@/lib/commerce/url";
import { orderTokens, streamAgents, usd } from "@/lib/commerce/client";
import { useWallet } from "../wallet/WalletProvider";
import { shortAddress } from "@/lib/format";
import { Modal } from "../ui/Modal";
import { CheckoutSheet } from "./CheckoutSheet";

type AgentState = { status: "working" | "done" | "skipped" | "error"; label: string; tool?: string; findings?: string[]; confidence?: number };
type Mode = "bajar_pay_sandbox" | "bajar_pay" | "external";
const ASSETS = ["USDC", "USDT", "ETH", "SOL", "BTC"] as const;
const CATEGORIES = [
  { label: "Headphones", q: "wireless headphones" }, { label: "Sneakers", q: "running sneakers" }, { label: "Backpacks", q: "travel backpack" },
  { label: "Phone cases", q: "phone case" }, { label: "Bedding", q: "sheets" }, { label: "Socks", q: "socks" },
];
const EXAMPLES = ["#Find #Compare wireless headphones under $250", "#Deals #Crypto running sneakers, pay with SOL", "#Find TEST laptop under $1000"];

export function AgentsApp() {
  const sp = useSearchParams();
  const { wallet, openModal } = useWallet();
  const [text, setText] = useState("");
  const [tags, setTags] = useState<AgentId[]>([]);
  const [asset, setAsset] = useState<(typeof ASSETS)[number]>("USDC");
  const [sandbox, setSandbox] = useState(true);
  const [running, setRunning] = useState(false);
  const [asked, setAsked] = useState<string | null>(null);
  const [agents, setAgents] = useState<Partial<Record<AgentId, AgentState>>>({});
  const [products, setProducts] = useState<Offer[]>([]);
  const [best, setBest] = useState<{ id: string | null; reason: string } | null>(null);
  const [summary, setSummary] = useState<{ text: string; ai: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Offer | null>(null);
  const [pay, setPay] = useState<Offer | null>(null);
  const [modes, setModes] = useState<Record<string, Mode>>({});
  const [deals, setDeals] = useState<Offer[] | null>(null);
  const abort = useRef<AbortController | null>(null);

  const link = useMemo(() => {
    const m = /https?:\/\/\S+/.exec(text)?.[0];
    return m ? parseProductLink(m) : null;
  }, [text]);

  useEffect(() => { fetch("/api/commerce/trending").then((r) => r.json()).then((b) => setDeals(b.deals ?? [])).catch(() => setDeals([])); }, []);
  // Deep link to a sandbox product (from the test store's product URLs).
  useEffect(() => {
    const p = sp.get("product");
    if (p && /^tst-[a-z0-9]+$/.test(p)) run(`#Find #Checkout https://www.sharebajar.com/agents?sandbox=1&product=${p}`, "Show me this Bajar Test Store item");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggle = (id: AgentId) => setTags((t) => (t.includes(id) ? t.filter((x) => x !== id) : [...t, id]));

  async function run(msg?: string, display?: string) {
    const m = (msg ?? text).trim();
    if (!m || running) return;
    abort.current?.abort();
    const ac = new AbortController();
    abort.current = ac;
    const withAsset = /\b(USDC|USDT|ETH|SOL|BTC)\b/i.test(m) ? m : `${m} ${asset}`;
    setRunning(true); setAsked(display ?? m); setAgents({}); setProducts([]); setBest(null); setSummary(null); setError(null); setModes({});
    try {
      await streamAgents({ message: withAsset, agents: tags.length ? tags : undefined, sandbox, orderTokens: orderTokens() }, (e) => {
        if (e.type === "agent") setAgents((a) => ({ ...a, [e.agent as AgentId]: e as unknown as AgentState }));
        else if (e.type === "products") setProducts(e.items as Offer[]);
        else if (e.type === "best") setBest(e as unknown as { id: string | null; reason: string });
        else if (e.type === "checkout") setModes((x) => ({ ...x, [(e.offer as Offer).id]: e.mode as Mode }));
        else if (e.type === "summary") setSummary({ text: String(e.text), ai: !!e.ai });
        else if (e.type === "error") setError(String(e.message));
      }, ac.signal);
    } catch (e) {
      if ((e as Error).name !== "AbortError") setError("The agents couldn't finish. Try again.");
    } finally { setRunning(false); }
    if (!msg) setText("");
  }

  const modeOf = (o: Offer): Mode => modes[o.id] ?? (o.sandbox ? "bajar_pay_sandbox" : "external");
  const started = asked !== null;

  return (
    <div className="mx-auto max-w-[1100px] px-4 pb-32 pt-6 sm:pt-10">
      {!started && (
        <section className="text-center mb-6">
          <div className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-3 py-1 text-[12px] text-muted mb-4"><Sparkles size={13} className="text-ai" />BAJAR Agents</div>
          <h1 className="font-display text-[34px] sm:text-[52px] leading-[1.05] tracking-tight text-fg">Anything you want.<br />One place to find it.</h1>
          <p className="mt-3 text-[15px] text-muted">Browse. Paste a link. Or simply chat.</p>
        </section>
      )}

      {/* Wallet + payment asset */}
      <div className="flex flex-wrap items-center justify-center gap-2 mb-3" data-testid="pay-selector">
        {wallet ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-surface px-3 h-9 text-[13px]"><Wallet size={14} /><span className="num">{shortAddress(wallet.address)}</span><span className="text-faint">· {wallet.chainType === "solana" ? "Solana" : "EVM"}</span></span>
        ) : (
          <button type="button" onClick={openModal} className="inline-flex items-center gap-1.5 rounded-full bg-surface px-3 h-9 text-[13px] text-muted hover:text-fg"><Wallet size={14} />Connect wallet to pay</button>
        )}
        <div className="inline-flex rounded-full bg-surface p-1" role="radiogroup" aria-label="Pay with">
          {ASSETS.map((a) => (
            <button key={a} type="button" role="radio" aria-checked={asset === a} onClick={() => setAsset(a)} className={clsx("h-7 px-2.5 rounded-full text-[12.5px] font-medium", asset === a ? "bg-surface-3 text-fg" : "text-muted")}>{a}</button>
          ))}
        </div>
      </div>

      {/* Unified search / chat / link input */}
      <form onSubmit={(e) => { e.preventDefault(); run(); }} className="rounded-[26px] bg-surface p-2 shadow-sm">
        <div className="flex items-end gap-2">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); run(); } }}
            rows={1}
            placeholder="Search, paste a link, or ask…"
            aria-label="Ask BAJAR Agents"
            data-testid="agents-input"
            className="flex-1 resize-none bg-transparent px-3 py-2.5 text-[15.5px] outline-none placeholder:text-faint max-h-40"
          />
          <button type="submit" disabled={!text.trim() || running} aria-label="Send" data-testid="agents-send" className="h-10 w-10 shrink-0 grid place-items-center rounded-full btn-ink disabled:opacity-40">
            {running ? <Loader2 size={17} className="animate-spin" /> : <ArrowUp size={18} />}
          </button>
        </div>
        {link && (
          <div className={clsx("mx-2 mb-1 mt-1 flex items-center gap-2 rounded-xl px-3 py-2 text-[12.5px]", link.blocked ? "bg-down/10 text-down" : "bg-surface-2 text-muted")} data-testid="link-chip">
            {link.blocked ? <ShieldAlert size={14} /> : <Link2 size={14} />}
            {link.blocked ? `Blocked: ${link.blocked}` : `Product link · ${link.host}${link.productId ? ` · ${link.productId}` : ""}`}
            {!link.blocked && link.warnings[0] && <span className="text-warn">· {link.warnings[0]}</span>}
          </div>
        )}
        <div className="flex gap-1.5 overflow-x-auto px-1 pt-1 pb-0.5 scroll-thin" aria-label="Agents">
          {AGENTS.map((a) => (
            <button key={a.id} type="button" onClick={() => toggle(a.id)} title={a.role} aria-pressed={tags.includes(a.id)} data-testid={`tag-${a.id}`}
              className={clsx("shrink-0 h-8 px-3 rounded-full text-[13px] font-medium transition-colors", tags.includes(a.id) ? "bg-fg text-[var(--bg)]" : "bg-surface-2 text-muted hover:text-fg")}>{a.tag}</button>
          ))}
        </div>
      </form>
      <div className="mt-2 flex items-center justify-between gap-2 px-2 text-[12px] text-faint">
        <label className="inline-flex items-center gap-1.5"><input type="checkbox" checked={sandbox} onChange={(e) => setSandbox(e.target.checked)} data-testid="sandbox-toggle" />Include Bajar Test Store (sandbox)</label>
        <Link href="/agents/orders" className="inline-flex items-center gap-1 hover:text-fg" data-testid="orders-link"><Package size={13} />Orders</Link>
      </div>

      {!started && (
        <>
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            {EXAMPLES.map((e) => <button key={e} type="button" onClick={() => setText(e)} className="rounded-full border-[0.5px] border-line px-3 py-1.5 text-[12.5px] text-muted hover:text-fg">{e}</button>)}
          </div>
          <section className="mt-10">
            <h2 className="text-[13px] uppercase tracking-wider text-faint mb-3">Categories</h2>
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
              {CATEGORIES.map((c) => <button key={c.label} type="button" onClick={() => run(`#Find #Deals #Compare ${c.q}`)} className="rounded-2xl bg-surface px-3 py-4 text-[13.5px] font-medium hover:bg-surface-2">{c.label}</button>)}
            </div>
          </section>
          <section className="mt-10" data-testid="trending">
            <h2 className="text-[13px] uppercase tracking-wider text-faint mb-3">Trending deals</h2>
            {deals === null ? <div className="text-sm text-muted">Loading live store prices…</div>
              : deals.length ? <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">{deals.slice(0, 8).map((o) => <ProductCard key={o.id} o={o} onOpen={() => setOpen(o)} />)}</div>
              : <div className="text-sm text-muted">No live discounts from the connected stores right now.</div>}
          </section>
        </>
      )}

      {started && (
        <div className="mt-6 space-y-5">
          <div className="flex justify-end"><div className="max-w-[80%] rounded-2xl bg-surface-2 px-4 py-2.5 text-[14.5px]">{asked}</div></div>

          {/* Agent workspace */}
          <section aria-label="Agent activity" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5" data-testid="agent-workspace">
            {AGENTS.filter((a) => agents[a.id]).map((a) => <AgentCard key={a.id} tag={a.tag} s={agents[a.id]!} id={a.id} />)}
            {running && !Object.keys(agents).length && <div className="text-sm text-muted">Starting agents…</div>}
          </section>

          {summary && (
            <div className="rounded-2xl bg-surface p-4" data-testid="agents-summary">
              <div className="text-[12px] text-faint mb-1 flex items-center gap-1"><Sparkles size={12} className="text-ai" />{summary.ai ? "Recommendation · written by Claude from the agents' findings" : "Recommendation"}</div>
              <p className="text-[15px] leading-relaxed">{summary.text}</p>
            </div>
          )}
          {error && <div className="rounded-2xl bg-down/10 text-down p-3 text-sm">{error}</div>}

          {products.length > 0 && (
            <section>
              <h2 className="text-[13px] uppercase tracking-wider text-faint mb-3">Offers</h2>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3" data-testid="offers">
                {products.map((o) => <ProductCard key={o.id} o={o} best={best?.id === o.id} onOpen={() => setOpen(o)} />)}
              </div>
            </section>
          )}
        </div>
      )}

      <Modal open={!!open} onClose={() => setOpen(null)} title={open?.merchant} wide>
        {open && <ProductSheet o={open} mode={modeOf(open)} onPay={() => { setPay(open); setOpen(null); }} />}
      </Modal>
      <CheckoutSheet offer={pay} asset={asset} onClose={() => setPay(null)} />
    </div>
  );
}

function AgentCard({ id, tag, s }: { id: AgentId; tag: string; s: AgentState }) {
  return (
    <div className="rounded-2xl bg-surface p-3.5" data-testid={`agent-${id}`} data-status={s.status}>
      <div className="flex items-center gap-2">
        <span className="text-[13px] font-semibold">{tag}</span>
        {s.tool && <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[10.5px] text-faint num">{s.tool}</span>}
        <span className="ml-auto">{s.status === "working" ? <Loader2 size={14} className="animate-spin text-muted" /> : s.confidence !== undefined && <span className="text-[11px] text-faint num" title="Confidence">{Math.round(s.confidence * 100)}%</span>}</span>
      </div>
      <div className="mt-1 text-[13.5px] text-fg">{s.label}</div>
      {s.status === "done" && s.confidence !== undefined && <div className="mt-2 h-1 rounded-full bg-surface-2 overflow-hidden"><div className="h-full bg-accent" style={{ width: `${Math.round(s.confidence * 100)}%` }} /></div>}
      {!!s.findings?.length && (
        <ul className="mt-2 space-y-1 text-[12.5px] text-muted">{s.findings.slice(0, 6).map((f, i) => <li key={i} className="leading-snug break-words">{f}</li>)}</ul>
      )}
    </div>
  );
}

function ProductCard({ o, best, onOpen }: { o: Offer; best?: boolean; onOpen: () => void }) {
  const off = o.compareAtPrice && o.price ? Math.round((1 - o.price / o.compareAtPrice) * 100) : 0;
  return (
    <button type="button" onClick={onOpen} className={clsx("text-left rounded-2xl bg-surface overflow-hidden hover:bg-surface-2 transition-colors", best && "ring-2 ring-accent")} data-testid="offer-card">
      <div className="aspect-square bg-surface-2 grid place-items-center overflow-hidden">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {o.image ? <img src={o.image} alt="" loading="lazy" className="h-full w-full object-cover" referrerPolicy="no-referrer" /> : <Package size={28} className="text-faint" />}
      </div>
      <div className="p-3">
        <div className="flex items-center gap-1 text-[11px] text-faint">{o.merchant}{o.sandbox && <span className="rounded bg-warn/15 text-warn px-1">TEST</span>}{best && <span className="ml-auto text-accent font-medium">Best</span>}</div>
        <div className="mt-0.5 text-[13.5px] leading-snug line-clamp-2">{o.title}</div>
        <div className="mt-1 flex items-baseline gap-1.5"><span className="num font-semibold">{usd(o.price)}</span>{off > 0 && <><span className="text-[12px] text-faint line-through num">{usd(o.compareAtPrice)}</span><span className="text-[11.5px] text-up">−{off}%</span></>}</div>
        {o.inStock === false && <div className="text-[11.5px] text-down">Out of stock</div>}
      </div>
    </button>
  );
}

function ProductSheet({ o, mode, onPay }: { o: Offer; mode: Mode; onPay: () => void }) {
  return (
    <div className="px-5 pb-5" data-testid="product-sheet">
      {o.image && <div className="aspect-[4/3] rounded-xl bg-surface-2 overflow-hidden mb-3">{/* eslint-disable-next-line @next/next/no-img-element */}<img src={o.image} alt="" className="h-full w-full object-contain" referrerPolicy="no-referrer" /></div>}
      <h3 className="text-[17px] font-semibold leading-snug">{o.title}</h3>
      <div className="mt-1 flex items-baseline gap-2"><span className="num text-[22px] font-semibold">{usd(o.price)}</span>{o.compareAtPrice && o.price && o.compareAtPrice > o.price && <span className="num text-faint line-through">{usd(o.compareAtPrice)}</span>}</div>
      <div className="mt-1 text-[12.5px] text-muted">{o.shipping === null ? "Shipping and tax shown at the merchant's checkout" : `Shipping ${usd(o.shipping)}`} · {o.inStock === null ? "Stock not published" : o.inStock ? "In stock" : "Out of stock"}</div>
      {Object.keys(o.specs).length > 0 && (
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-[13px]">{Object.entries(o.specs).slice(0, 8).map(([k, v]) => <div key={k} className="contents"><dt className="text-faint">{k}</dt><dd className="truncate">{v}</dd></div>)}</dl>
      )}
      <div className="mt-3 rounded-xl bg-surface-2 p-3 text-[12.5px] text-muted" data-testid="capability">
        <div className="flex items-center gap-1.5 text-fg font-medium"><BadgeCheck size={14} />{mode === "external" ? "Checkout on the merchant's site" : mode === "bajar_pay_sandbox" ? "BAJAR Pay · sandbox merchant" : "BAJAR Pay"}</div>
        <div className="mt-0.5">Data: {o.source} · {new Date(o.fetchedAt).toLocaleTimeString()}</div>
        {mode === "external" && <div className="mt-0.5">This merchant isn&apos;t connected to BAJAR Pay. You&apos;ll leave Bajar to buy on {o.merchantDomain}.</div>}
        {o.sandbox && <div className="mt-0.5 text-warn">Test item: sandbox orders move no money and nothing ships.</div>}
      </div>
      <div className="mt-4">
        {mode === "external" ? (
          <a href={o.url} target="_blank" rel="noopener noreferrer nofollow" className="w-full h-12 rounded-full bg-surface-2 hover:bg-surface-3 font-medium flex items-center justify-center gap-2" data-testid="external-checkout">Buy on {o.merchantDomain}<ExternalLink size={15} /></a>
        ) : (
          <button type="button" onClick={onPay} disabled={o.inStock === false} className="w-full h-12 rounded-full btn-ink font-medium disabled:opacity-40" data-testid="pay-with-bajar">Pay with BAJAR{mode === "bajar_pay_sandbox" ? " (sandbox)" : ""}</button>
        )}
      </div>
    </div>
  );
}
