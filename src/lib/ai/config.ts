export const AI_MODEL = "claude-opus-5-5";

export function aiConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

/** Events streamed to the browser as NDJSON. */
export type AiEvent =
  | { type: "text"; text: string }
  | { type: "tool"; name: string; label: string }
  | { type: "action"; action: AiAction }
  | { type: "done"; model: string; pro?: boolean }
  | { type: "error"; message: string };

export type AiAction =
  | { kind: "watchlist"; name: string; items: { kind: "coin" | "token"; id: string; label: string; chain?: string; address?: string }[] }
  | { kind: "alert"; label: string; target: { kind: "coin" | "token"; id: string; chain?: string; address?: string }; condition: "above" | "below"; price: number }
  | { kind: "trade"; side: "buy" | "sell"; symbol: string; amountUsd: number; network?: string; address?: string; reason: string };

export type AiContext =
  | { kind: "coin"; id: string }
  | { kind: "token"; chain: string; address: string }
  | { kind: "portfolio"; portfolio: { totalUsd: number; walletCount: number; chains: string[]; holdings: { symbol: string; network: string; valueUsd: number; pct: number; change24h: number | null }[] } }
  | null;
