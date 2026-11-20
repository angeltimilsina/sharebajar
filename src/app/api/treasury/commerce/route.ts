import { requireRole } from "@/lib/treasury/access";
import { handle } from "@/lib/treasury/http";
import { commerceRevenue } from "@/lib/commerce/orders";

/** Commerce revenue for admins: GMV, BAJAR fees, merchant commissions, refunds, net — sandbox kept separate. */
export async function GET(req: Request) {
  return handle(async () => {
    await requireRole(req, "viewer", "commerce.read");
    return commerceRevenue();
  });
}
