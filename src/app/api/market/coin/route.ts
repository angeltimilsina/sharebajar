import { getCoinDetail } from "@/lib/market/markets";
import { fail, param } from "@/lib/server/respond";
import { NextResponse } from "next/server";

export async function GET(req: Request) {
  try {
    const r = await getCoinDetail(param(new URL(req.url), "id"));
    if (!r) return NextResponse.json({ error: "Coin not found" }, { status: 404 });
    return NextResponse.json({ ...r, source: "CoinLore + Binance" });
  } catch (e) {
    return fail(e, "CoinLore");
  }
}
