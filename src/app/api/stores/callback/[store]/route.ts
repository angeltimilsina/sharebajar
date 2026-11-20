import { timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { completeStoreLogin, connectorById, getShoppingProfile, mergeImport, saveShoppingProfile, saveStoreAccount } from "@/lib/commerce/profile";
import { unseal } from "@/lib/server/auth";
import { requestHost } from "@/lib/server/guard";

interface Pending { store: string; profileId: string; nonce: string; host: string; redirectUri: string; exp: number }

/** OAuth return: checks state, exchanges the code, records the store account and clones the profile details it shares. */
export async function GET(req: Request, ctx: { params: Promise<{ store: string }> }) {
  const { store } = await ctx.params;
  const u = new URL(req.url);
  const back = (q: string) => {
    const res = NextResponse.redirect(new URL(`/agents/profile?${q}`, req.url));
    res.cookies.delete({ name: "sb_oauth", path: "/api/stores/callback" });
    return res;
  };
  const c = connectorById(store);
  const pending = unseal<Pending>((await cookies()).get("sb_oauth")?.value, "oauth");
  const state = u.searchParams.get("state") ?? "";
  const ok = !!pending && !!c && pending.store === c.id && pending.host === requestHost(req) && state.length === pending.nonce.length && timingSafeEqual(Buffer.from(state), Buffer.from(pending.nonce));
  if (!ok) return back("error=state");
  if (u.searchParams.get("error")) return back(`error=denied&store=${c!.id}`);
  const code = u.searchParams.get("code");
  if (!code || code.length > 2000) return back(`error=code&store=${c!.id}`);
  try {
    const login = await completeStoreLogin(c!.id, code, pending!.redirectUri);
    await saveStoreAccount(pending!.profileId, c!.id, login);
    if (login.profileImport) await saveShoppingProfile(pending!.profileId, mergeImport(await getShoppingProfile(pending!.profileId), login.profileImport));
    return back(`connected=${c!.id}`);
  } catch {
    return back(`error=exchange&store=${c!.id}`);
  }
}
