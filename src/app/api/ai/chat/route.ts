import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { AI_MODEL, aiConfigured, type AiEvent } from "@/lib/ai/config";
import { buildTools, TOOL_LABELS } from "@/lib/ai/tools";
import { SYSTEM_PROMPT } from "@/lib/ai/prompt";
import { getChain } from "@/lib/chains";
import { clientIp, rateLimit } from "@/lib/server/ratelimit";
import { log } from "@/lib/server/log";
import { NextResponse } from "next/server";

export const maxDuration = 120;

const Body = z.object({
  messages: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().min(1).max(6000) })).min(1).max(30),
  context: z
    .union([
      z.object({ kind: z.literal("coin"), id: z.string().max(80) }),
      z.object({ kind: z.literal("token"), chain: z.string().max(20), address: z.string().max(64) }),
    ])
    .nullish(),
});

class TruncatedToolInput extends Error {}

export async function POST(req: Request) {
  if (!aiConfigured()) {
    return NextResponse.json({ error: "Bajar Intelligence is not configured on this deployment (missing ANTHROPIC_API_KEY)." }, { status: 503 });
  }
  const rl = rateLimit(`ai:${clientIp(req)}`, 8, 10);
  if (!rl.ok) return NextResponse.json({ error: `Rate limit reached. Try again in ${rl.retryAfter}s.` }, { status: 429 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const { messages, context } = parsed.data;
  if (messages[messages.length - 1].role !== "user") return NextResponse.json({ error: "Last message must be from the user" }, { status: 400 });

  let contextNote = `Current time: ${new Date().toISOString()}.`;
  if (context?.kind === "coin") contextNote += ` The user is viewing the coin with Bajar slug "${context.id}" (use get_coin with it). Questions like "this token" refer to it.`;
  if (context?.kind === "token" && getChain(context.chain)) contextNote += ` The user is viewing the DEX token ${context.address} on ${context.chain}. Questions like "this token" refer to it.`;

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (e: AiEvent) => controller.enqueue(encoder.encode(JSON.stringify(e) + "\n"));
      const client = new Anthropic();
      const tools = buildTools({ action: (a) => send({ type: "action", action: a }) });
      let runner = client.beta.messages.toolRunner({
        model: AI_MODEL,
        max_tokens: 16000,
        max_iterations: 8,
        output_config: { effort: "medium" },
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        system: [
          // Stable prefix is cached; per-request context comes after it.
          { type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
          { type: "text", text: contextNote },
        ],
        tools,
        messages,
        stream: true,
      });
      try {
        for (let attempt = 0; ; attempt++) {
          try {
            for await (const messageStream of runner) {
              for await (const event of messageStream) {
                if (event.type === "content_block_start" && event.content_block.type === "tool_use") {
                  send({ type: "tool", name: event.content_block.name, label: TOOL_LABELS[event.content_block.name] ?? event.content_block.name });
                } else if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
                  send({ type: "text", text: event.delta.text });
                }
              }
              const message = await messageStream.finalMessage();
              attempt = 0;
              const hasToolUse = message.content.some((b) => b.type === "tool_use");
              if (message.stop_reason === "max_tokens" && hasToolUse) throw new TruncatedToolInput("Response was cut off. Please ask a narrower question.");
              if (message.stop_reason === "refusal") {
                send({ type: "text", text: "\n\n_I can't help with that request._" });
                break;
              }
            }
            break;
          } catch (err) {
            if (err instanceof Anthropic.APIError || err instanceof TruncatedToolInput || attempt >= 2) throw err;
            log("warn", "ai tool input unparseable, retrying turn", { attempt });
            runner = client.beta.messages.toolRunner({ ...runner.params });
          }
        }
        send({ type: "done", model: AI_MODEL });
      } catch (err) {
        let message = "The AI service failed to respond. Please try again.";
        if (err instanceof Anthropic.RateLimitError) message = "The AI service is busy (rate limited). Please retry shortly.";
        else if (err instanceof Anthropic.AuthenticationError) message = "AI service credentials are invalid on this deployment.";
        else if (err instanceof Anthropic.APIConnectionError) message = "Could not reach the AI service.";
        else if (err instanceof TruncatedToolInput) message = err.message;
        log("error", "ai chat failed", { error: String(err) });
        send({ type: "error", message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store", "x-accel-buffering": "no" } });
}
