"use client";
import { useEffect, useRef, useState } from "react";
import { Send, Loader2, Sparkles, Square, Check, ListPlus, BellPlus, ArrowUp } from "lucide-react";
import { aiStatus, streamChat, type ChatMessage } from "@/lib/ai/client";
import type { AiAction } from "@/lib/ai/config";
import { useAlerts, useWatchlist } from "@/hooks/useWatchlist";
import { Badge, Button, Card, Notice } from "../ui/primitives";
import { Markdown } from "./Markdown";
import { formatPrice } from "@/lib/format";

interface Turn extends ChatMessage { steps?: string[]; actions?: AiAction[]; error?: string }

const SUGGESTIONS = [
  "Give me a market overview: what's moving today and why?",
  "Explain RSI and MACD using BTC's current 1h data.",
  "Compare Solana and Ethereum ecosystems by price action and DEX activity.",
  "Which trending Solana pools show unusual liquidity or buy pressure?",
  "Summarize the most important crypto news from the last few hours.",
  "Build me a watchlist of the top 5 Solana ecosystem tokens.",
];

export function Chat() {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  // Prefill from ?q= (suggested prompts on the home page). Never auto-sends.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("q");
    if (q) setInput(q.slice(0, 500));
  }, []);
  const [busy, setBusy] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => { aiStatus().then((s) => setConfigured(s.configured)); }, []);
  // Follow the conversation only once it has started (don't jump the page on first load).
  useEffect(() => { if (turns.length) endRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }); }, [turns]);

  const send = async (text: string) => {
    const content = text.trim();
    if (!content || busy) return;
    const history: Turn[] = [...turns, { role: "user", content }];
    setTurns([...history, { role: "assistant", content: "", steps: [] }]);
    setInput("");
    setBusy(true);
    abort.current = new AbortController();
    const update = (fn: (t: Turn) => Turn) => setTurns((ts) => [...ts.slice(0, -1), fn(ts[ts.length - 1])]);
    try {
      await streamChat(
        history.filter((t) => t.content).map(({ role, content }) => ({ role, content })),
        null,
        (e) => {
          if (e.type === "text") update((t) => ({ ...t, content: t.content + e.text }));
          else if (e.type === "tool") update((t) => ({ ...t, steps: [...(t.steps ?? []), e.label] }));
          else if (e.type === "action") update((t) => ({ ...t, actions: [...(t.actions ?? []), e.action] }));
          else if (e.type === "error") update((t) => ({ ...t, error: e.message }));
        },
        abort.current.signal,
      );
    } catch (e) {
      if ((e as Error).name !== "AbortError") update((t) => ({ ...t, error: "Connection to the AI service was interrupted." }));
    } finally {
      setBusy(false);
      update((t) => (t.content || t.error ? t : { ...t, error: t.error ?? "No response." }));
    }
  };

  return (
    <Card className="flex flex-col min-h-[640px]">
      <div className="flex items-center gap-2.5 px-4 py-3 border-b border-line">
        <span className="h-8 w-8 rounded-lg grid place-items-center bg-brand-soft text-brand font-bold text-xs border border-brand/30">AI</span>
        <div className="flex-1"><div className="font-semibold">Bajar Intelligence</div><div className="text-[11px] text-muted">Grounded in live market data · analysis, not financial advice</div></div>
        {configured && <Badge tone="up">Online</Badge>}
        {configured === false && <Badge tone="warn">Not configured</Badge>}
      </div>
      <div className="flex-1 overflow-y-auto scroll-thin px-4 py-4 space-y-4">
        {configured === false && (
          <Notice tone="warn" title="AI assistant not configured">This deployment has no <code>ANTHROPIC_API_KEY</code>, so the assistant can&apos;t answer yet. The unusual-activity signals and news on this page are still live.</Notice>
        )}
        {!turns.length && (
          <div className="py-6">
            <div className="text-center mb-5">
              <Sparkles className="mx-auto text-ai" size={28} />
              <h2 className="mt-2 font-semibold text-lg">What do you want to know about the market?</h2>
              <p className="text-xs text-muted mt-1">The assistant pulls live prices, indicators, on-chain activity, security checks and news before answering.</p>
            </div>
            <div className="grid sm:grid-cols-2 gap-2">
              {SUGGESTIONS.map((s) => <button key={s} disabled={!configured} onClick={() => send(s)} className="text-left text-[13px] rounded-xl border border-line bg-surface-2 hover:bg-surface-3 px-3 py-2.5 disabled:opacity-50">{s}</button>)}
            </div>
          </div>
        )}
        {turns.map((t, i) => (
          <div key={i} className={t.role === "user" ? "flex justify-end" : ""}>
            {t.role === "user" ? (
              <div className="max-w-[85%] rounded-2xl rounded-br-md bg-brand-soft border border-brand/25 px-3.5 py-2 text-sm whitespace-pre-wrap">{t.content}</div>
            ) : (
              <div className="max-w-full">
                {!!t.steps?.length && (
                  <div className="flex flex-wrap gap-1.5 mb-2">{t.steps.map((s, j) => <Badge key={j} tone="ai">{busy && i === turns.length - 1 && j === t.steps!.length - 1 && !t.content ? <Loader2 size={10} className="animate-spin" /> : <Check size={10} />}{s}</Badge>)}</div>
                )}
                {t.content ? <Markdown text={t.content} /> : busy && i === turns.length - 1 && !t.error ? <div className="text-xs text-muted flex items-center gap-2"><Loader2 size={13} className="animate-spin" /> Analyzing…</div> : null}
                {t.actions?.map((a, j) => <ActionCard key={j} action={a} />)}
                {t.error && <div className="text-xs text-down mt-1">{t.error}</div>}
              </div>
            )}
          </div>
        ))}
        <div ref={endRef} />
      </div>
      <form onSubmit={(e) => { e.preventDefault(); send(input); }} className="p-3 sm:p-4">
        <div className="flex items-end gap-2 rounded-2xl border border-line-strong bg-bg px-3.5 py-2.5 focus-within:border-[color-mix(in_srgb,var(--text)_35%,transparent)] transition-colors">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input); } }}
            rows={1}
            maxLength={4000}
            disabled={!configured}
            placeholder={configured ? "Ask about any token, chain or market move…" : "AI assistant unavailable on this deployment"}
            className="flex-1 resize-none bg-transparent py-1.5 text-[15px] outline-none max-h-40 placeholder:text-faint"
            aria-label="Message"
          />
          {busy ? <button type="button" onClick={() => abort.current?.abort()} aria-label="Stop" className="h-9 w-9 shrink-0 rounded-full bg-surface-3 grid place-items-center"><Square size={13} /></button>
            : <button type="submit" disabled={!configured || !input.trim()} aria-label="Send" className="h-9 w-9 shrink-0 rounded-full btn-ink grid place-items-center disabled:opacity-30"><ArrowUp size={17} /></button>}
        </div>
        <p className="mt-2 text-center text-[11px] text-faint">Not financial advice. Verify important information.</p>
      </form>
    </Card>
  );
}

function ActionCard({ action }: { action: AiAction }) {
  const wl = useWatchlist();
  const al = useAlerts();
  const [done, setDone] = useState(false);
  if (action.kind === "watchlist") {
    return (
      <div className="mt-2 rounded-xl border border-ai/30 bg-ai/[0.06] p-3 text-sm">
        <div className="font-semibold flex items-center gap-1.5"><ListPlus size={15} className="text-ai" /> Proposed watchlist: {action.name}</div>
        <div className="flex flex-wrap gap-1.5 my-2">{action.items.map((i) => <Badge key={i.id + (i.address ?? "")}>{i.label}</Badge>)}</div>
        <Button size="sm" disabled={done} onClick={() => {
          wl.addMany(action.items.map((i) => (i.kind === "token" && i.chain && i.address ? { kind: "token" as const, id: i.address, chain: i.chain, address: i.address, label: i.label } : { kind: "coin" as const, id: i.id, label: i.label })));
          setDone(true);
        }}>{done ? <><Check size={13} /> Added to watchlist</> : "Add to my watchlist"}</Button>
      </div>
    );
  }
  return (
    <div className="mt-2 rounded-xl border border-ai/30 bg-ai/[0.06] p-3 text-sm">
      <div className="font-semibold flex items-center gap-1.5"><BellPlus size={15} className="text-ai" /> Proposed alert: {action.label}</div>
      <div className="text-xs text-muted my-1.5">Notify when price goes {action.condition} {formatPrice(action.price)} (checked every 30s while Bajar is open).</div>
      <Button size="sm" disabled={done} onClick={() => {
        al.add({ label: action.label, target: action.target, condition: action.condition, price: action.price });
        if ("Notification" in window && Notification.permission === "default") Notification.requestPermission().catch(() => {});
        setDone(true);
      }}>{done ? <><Check size={13} /> Alert created</> : "Create alert"}</Button>
    </div>
  );
}
