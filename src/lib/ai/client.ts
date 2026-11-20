"use client";
import type { AiContext, AiEvent } from "./config";

export interface ChatMessage { role: "user" | "assistant"; content: string }

/** Streams NDJSON events from /api/ai/chat. */
export async function streamChat(messages: ChatMessage[], context: AiContext, onEvent: (e: AiEvent) => void, signal?: AbortSignal) {
  const res = await fetch("/api/ai/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ messages, context }), signal });
  if (!res.ok || !res.body) {
    const b = await res.json().catch(() => ({}));
    onEvent({ type: "error", message: b.error ?? `AI request failed (${res.status})` });
    return;
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (line) { try { onEvent(JSON.parse(line)); } catch { /* ignore partial */ } }
    }
  }
}

let statusCache: Promise<{ configured: boolean; model: string | null }> | null = null;
export function aiStatus() {
  return (statusCache ??= fetch("/api/ai/status").then((r) => r.json()).catch(() => ({ configured: false, model: null })));
}
