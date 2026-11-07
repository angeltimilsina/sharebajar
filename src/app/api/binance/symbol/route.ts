import { binanceSymbolFor } from "@/lib/market/binance";
import { NextResponse } from "next/server";

export async function GET(req: Request) {
  const base = new URL(req.url).searchParams.get("base") ?? "";
  if (!/^[A-Za-z0-9]{1,15}$/.test(base)) return NextResponse.json({ symbol: null });
  return NextResponse.json({ symbol: await binanceSymbolFor(base) }, { headers: { "cache-control": "public, s-maxage=3600" } });
}
