import { requireRole } from "@/lib/treasury/access";
import { handle, TreasuryError } from "@/lib/treasury/http";
import { getTreasury } from "@/lib/treasury/store";
import { adapterFor } from "@/lib/treasury/adapters";
import { priceAt } from "@/lib/treasury/prices";
import { toDecimal } from "@/lib/treasury/classify";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    await requireRole(req, "viewer", "treasury.balances");
    const { id } = await params;
    const t = await getTreasury(id);
    if (!t) throw new TreasuryError(404, "Treasury not found");
    const bal = await adapterFor(t.chain).balances(t);
    const now = Date.now();
    const rows = await Promise.all(bal.map(async (b) => {
      const amount = toDecimal(BigInt(b.amountRaw), b.decimals);
      const p = await priceAt(t.chain, b.token, b.symbol, now);
      return { ...b, amount, usdPrice: p.price, usdValue: p.price !== null ? Number(amount) * p.price : null, priceSource: p.source };
    }));
    return { treasuryId: id, fetchedAt: now, balances: rows, totalUsd: rows.reduce((s, r) => s + (r.usdValue ?? 0), 0) };
  });
}
