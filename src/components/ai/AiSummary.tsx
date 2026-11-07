"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Sparkles, Loader2, Info } from "lucide-react";
import { aiStatus, streamChat } from "@/lib/ai/client";
import type { AiContext } from "@/lib/ai/config";
import { Badge, Button, Card, CardHeader } from "../ui/primitives";
import { Markdown } from "./Markdown";

/**
 * AI market summary for the token in view. Always shows deterministic,
 * data-derived observations; the AI narrative is opt-in and clearly labelled.
 */
export function AiSummary({ context, name, insights }: { context: AiContext; name: string; insights: { text: string; tone?: "up" | "down" | "warn" | "info" }[] }) {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => { aiStatus().then((s) => setConfigured(s.configured)); return () => abort.current?.abort(); }, []);

  const run = async () => {
    setBusy(true); setText(""); setError(null);
    abort.current = new AbortController();
    try {
      await streamChat(
        [{ role: "user", content: `Give me a concise market summary of ${name}: recent price and volume action, liquidity/holder or on-chain observations, notable risks and any relevant news. Separate observations from interpretation. Keep it under 220 words.` }],
        context,
        (e) => {
          if (e.type === "text") { setStep(null); setText((t) => t + e.text); }
          if (e.type === "tool") setStep(e.label);
          if (e.type === "error") setError(e.message);
        },
        abort.current.signal,
      );
    } catch (e) {
      if ((e as Error).name !== "AbortError") setError("AI request failed.");
    } finally { setBusy(false); setStep(null); }
  };

  return (
    <Card>
      <CardHeader title="Market Intelligence" icon={<Badge tone="ai" className="ml-1">AI</Badge>} action={<Link href="/intelligence" className="text-xs text-brand hover:underline">Ask more</Link>} />
      <div className="px-4 pb-4 space-y-3">
        {insights.length > 0 && (
          <div>
            <div className="text-[11px] uppercase tracking-wider text-faint mb-1.5">Data signals</div>
            <ul className="space-y-1.5">
              {insights.map((s, i) => (
                <li key={i} className="flex gap-2 text-[13px]">
                  <span className={`mt-1.5 h-1.5 w-1.5 rounded-full shrink-0 ${s.tone === "up" ? "bg-up" : s.tone === "down" ? "bg-down" : s.tone === "warn" ? "bg-warn" : "bg-faint"}`} />
                  <span>{s.text}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {configured === false && (
          <div className="flex gap-2 text-xs text-muted rounded-lg border border-line bg-surface-2 p-2.5"><Info size={14} className="shrink-0 mt-0.5" /> AI summaries are not configured on this deployment. The signals above are computed directly from market data.</div>
        )}
        {configured && !text && !busy && <Button variant="subtle" size="sm" onClick={run}><Sparkles size={14} className="text-ai" /> Generate AI summary</Button>}
        {busy && !text && <div className="flex items-center gap-2 text-xs text-muted"><Loader2 size={14} className="animate-spin" /> {step ?? "Thinking…"}</div>}
        {text && (
          <div className="rounded-lg border border-ai/25 bg-ai/[0.05] p-3">
            <Markdown text={text} />
            {busy && step && <div className="flex items-center gap-2 text-xs text-muted mt-1"><Loader2 size={12} className="animate-spin" /> {step}</div>}
            <div className="mt-2 text-[10.5px] text-faint">AI-generated from live market data. Analysis, not financial advice; may contain errors.</div>
          </div>
        )}
        {error && <div className="text-xs text-down">{error}</div>}
      </div>
    </Card>
  );
}
