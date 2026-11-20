import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// The gateway reads the httpOnly session cookie through next/headers; stand in for the request's cookie jar.
const jar = new Map<string, string>();
vi.mock("next/headers", () => ({ cookies: async () => ({ get: (n: string) => (jar.has(n) ? { name: n, value: jar.get(n)! } : undefined) }) }));

/** Minimal NextResponse stand-in that records cookies set/deleted. */
function fakeRes() {
  const set = new Map<string, string>();
  const deleted: string[] = [];
  return { set, deleted, cookies: { set: (n: string, v: string) => { set.set(n, v); }, delete: (n: string | { name: string }) => { deleted.push(typeof n === "string" ? n : n.name); } } } as never as { set: Map<string, string>; deleted: string[]; cookies: { set(n: string, v: string): void; delete(n: string): void } };
}

describe("auth gateway", () => {
  beforeAll(async () => { (await import("@/lib/treasury/db")).__useMemoryDb(); });
  beforeEach(async () => { jar.clear(); (await import("@/lib/server/gateway")).__clearGatewayCache(); });

  it("issues a recorded session only through issueSession, and reads it back verified", async () => {
    const g = await import("@/lib/server/gateway");
    const res = fakeRes();
    const s = await g.issueSession(res as never, true, { address: "So1anaAddr1111111111111111111111111111111", chainType: "solana" });
    expect(s.sid).toBeTruthy();
    jar.set("sb_session", res.set.get("sb_session")!);
    expect((await g.readSession())?.address).toBe(s.address);
  });

  it("rejects pre-gateway cookies (no server record) and forged ones", async () => {
    const g = await import("@/lib/server/gateway");
    const { seal } = await import("@/lib/server/auth");
    jar.set("sb_session", seal({ address: "X", chainType: "solana", exp: Date.now() + 1e6 }, "session"));
    expect(await g.readSession()).toBeNull();
    jar.set("sb_session", seal({ address: "X", chainType: "solana", exp: Date.now() + 1e6, sid: "made-up" }, "session"));
    expect(await g.readSession()).toBeNull();
    jar.set("sb_session", "garbage.value");
    expect(await g.readSession()).toBeNull();
  });

  it("a session can't be moved to another address", async () => {
    const g = await import("@/lib/server/gateway");
    const { seal, unseal } = await import("@/lib/server/auth");
    const res = fakeRes();
    await g.issueSession(res as never, true, { address: "0xAbCdEf0000000000000000000000000000000001", chainType: "evm" });
    const real = unseal<Record<string, unknown>>(res.set.get("sb_session"), "session")!;
    jar.set("sb_session", seal({ ...real, address: "0x0000000000000000000000000000000000000002" }, "session"));
    expect(await g.readSession()).toBeNull();
  });

  it("signing out revokes the session server-side; 'everywhere' ends every session of the address", async () => {
    const g = await import("@/lib/server/gateway");
    const a = fakeRes(), b = fakeRes(), other = fakeRes();
    await g.issueSession(a as never, true, { address: "AddrA", chainType: "solana" });
    await g.issueSession(b as never, true, { address: "AddrA", chainType: "solana" });
    await g.issueSession(other as never, true, { address: "AddrB", chainType: "solana" });
    jar.set("sb_session", a.set.get("sb_session")!);
    const out = fakeRes();
    await g.endSession(out as never);
    expect(out.deleted).toContain("sb_session");
    expect(await g.readSession()).toBeNull(); // the copied cookie no longer works
    jar.set("sb_session", b.set.get("sb_session")!);
    expect(await g.readSession()).not.toBeNull(); // other device still signed in
    await g.endSession(fakeRes() as never, { everywhere: true });
    expect(await g.readSession()).toBeNull();
    jar.set("sb_session", other.set.get("sb_session")!);
    expect(await g.readSession()).not.toBeNull(); // another account is untouched
  });

  it("renews while used but never past 30 days from the signature, keeping the sign-in time", async () => {
    const g = await import("@/lib/server/gateway");
    const day = 86400_000, now = Date.now();
    const s = { address: "A", chainType: "solana" as const, sid: "x", iat: now - 10 * day, exp: now + day };
    const res = fakeRes();
    const r = await g.renewIfDue(res as never, true, s);
    expect(r.iat).toBe(s.iat);
    expect(r.exp).toBeGreaterThan(s.exp);
    const old = { ...s, iat: now - 29.5 * day, exp: now + 0.4 * day };
    const r2 = await g.renewIfDue(fakeRes() as never, true, old);
    expect(r2.exp).toBeLessThanOrEqual(old.iat + 30 * day);
  });
});

describe("joining a Bajar profile after signing in", () => {
  beforeAll(async () => { (await import("@/lib/treasury/db")).__useMemoryDb(); });
  it("moves a wallet whose own profile is empty; refuses one that has its own data", async () => {
    const { linkWallet } = await import("@/lib/pro/profile");
    const { q } = await import("@/lib/treasury/db");
    await q("insert into profiles (id) values ('prf_main'), ('prf_solo'), ('prf_busy') on conflict do nothing");
    await q("insert into profile_wallets (address, profile_id, chain_type) values ('SoloWallet1111', 'prf_solo', 'solana'), ('BusyWallet1111', 'prf_busy', 'solana') on conflict do nothing");
    await q("insert into shopping_profiles (profile_id, data_enc) values ('prf_busy', 'x') on conflict do nothing");
    expect(await linkWallet("prf_main", "solana", "SoloWallet1111", "Phone")).toEqual({ ok: true });
    expect((await q<{ profile_id: string }>("select profile_id from profile_wallets where address='SoloWallet1111'"))[0].profile_id).toBe("prf_main");
    expect(await linkWallet("prf_main", "solana", "BusyWallet1111", null)).toMatchObject({ ok: false });
  });
});
