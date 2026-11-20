"use client";
import nacl from "tweetnacl";
import bs58 from "bs58";

/**
 * Solana wallet deep-link protocol (Phantom's spec, also implemented by
 * Solflare and Backpack): on phones, the browser asks the wallet app to
 * connect or sign, the app shows the request, then redirects back to this
 * page with an encrypted reply. No extension; the user stays in their browser.
 *
 * Security
 *  - Requests and replies are encrypted with NaCl box (x25519 + XSalsa20-
 *    Poly1305) between a per-connection dapp key and Phantom's key.
 *  - Every request gets a random id stored locally; a reply is accepted only
 *    if it matches a pending id (single use, expires after 15 minutes), so a
 *    crafted URL can't inject a fake connection or signature.
 *  - The page navigates away while Phantom is open, so the action to resume
 *    (e.g. "send this signed swap") is saved with the request.
 */
export const LINK_WALLETS = {
  phantom: { name: "Phantom", base: "https://phantom.app/ul/v1" },
  solflare: { name: "Solflare", base: "https://solflare.com/ul/v1" },
  backpack: { name: "Backpack", base: "https://backpack.app/ul/v1" },
} as const;
export type LinkWallet = keyof typeof LINK_WALLETS;
/** Wallet ids used for deep-link sessions, e.g. "phantom-mobile". */
export const linkId = (w: LinkWallet) => `${w}-mobile`;
export const PHANTOM_MOBILE = linkId("phantom");
/** The deep-link wallet behind a session id, or null for injected wallets. */
export function linkWalletOf(walletId: string | undefined | null): LinkWallet | null {
  const m = /^(phantom|solflare|backpack)-mobile$/.exec(walletId ?? "");
  return m ? (m[1] as LinkWallet) : null;
}
const STATE = (w: LinkWallet) => `bajar.link.${w}.v1`;
const PENDING = "bajar.link.pending.v1";
const TTL = 15 * 60_000;
const REQ = "link_req";
const BASE_PARAMS = [REQ, "nonce", "data", "errorCode", "errorMessage"];
const stripReply = (u: URL) => { for (const k of [...u.searchParams.keys()]) if (BASE_PARAMS.includes(k) || k.endsWith("_encryption_public_key")) u.searchParams.delete(k); };

interface State { dappPub: string; dappSec: string; walletPub?: string; session?: string; publicKey?: string }
export type Resume =
  | { kind: "connect" }
  | { kind: "send"; summary: string; chain: "solana" }
  | { kind: "swap"; route: "build" | "order"; requestId: string | null; intentToken?: string | null; summary: string; assetHref?: string; activityKind: "swap" | "trade" }
  | { kind: "signin" };
type Pending = Resume & { at: number; wallet: LinkWallet };

const read = <T,>(k: string, d: T): T => { try { return JSON.parse(localStorage.getItem(k) ?? "null") ?? d; } catch { return d; } };
const write = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage blocked */ } };
const b64ToBytes = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const bytesToB64 = (u: Uint8Array) => { let s = ""; u.forEach((b) => (s += String.fromCharCode(b))); return btoa(s); };

/** Connected account for a deep-link wallet (from a previous connect), if any. */
export function linkSession(w: LinkWallet): { publicKey: string } | null {
  const s = read<State | null>(STATE(w), null);
  return s?.session && s.publicKey ? { publicKey: s.publicKey } : null;
}
export function clearLinkSession(w: LinkWallet) { try { localStorage.removeItem(STATE(w)); } catch { /* ignore */ } }

function newRequest(w: LinkWallet, r: Resume): string {
  const id = bs58.encode(nacl.randomBytes(12));
  const all = read<Record<string, Pending>>(PENDING, {});
  for (const [k, v] of Object.entries(all)) if (Date.now() - v.at > TTL) delete all[k];
  all[id] = { ...r, at: Date.now(), wallet: w };
  write(PENDING, all);
  return id;
}

function redirectLink(id: string): string {
  const u = new URL(window.location.href);
  stripReply(u);
  u.searchParams.set(REQ, id);
  u.hash = "";
  return u.toString();
}

function go(w: LinkWallet, method: string, params: Record<string, string>) {
  window.location.href = `${LINK_WALLETS[w].base}/${method}?${new URLSearchParams(params).toString()}`;
}

/** Ask the wallet app to connect; it redirects back here with the account. */
export function linkConnect(w: LinkWallet) {
  const kp = nacl.box.keyPair();
  write(STATE(w), { dappPub: bs58.encode(kp.publicKey), dappSec: bs58.encode(kp.secretKey) } satisfies State);
  const id = newRequest(w, { kind: "connect" });
  go(w, "connect", { app_url: window.location.origin, dapp_encryption_public_key: bs58.encode(kp.publicKey), redirect_link: redirectLink(id), cluster: "mainnet-beta" });
}

function encrypted(w: LinkWallet, payload: object) {
  const s = read<State | null>(STATE(w), null);
  if (!s?.session || !s.walletPub) throw new Error(`${LINK_WALLETS[w].name} isn't connected. Connect again.`);
  const shared = nacl.box.before(bs58.decode(s.walletPub), bs58.decode(s.dappSec));
  const nonce = nacl.randomBytes(24);
  const box = nacl.box.after(new TextEncoder().encode(JSON.stringify({ ...payload, session: s.session })), nonce, shared);
  return { dapp_encryption_public_key: s.dappPub, nonce: bs58.encode(nonce), payload: bs58.encode(box) };
}

/** Ask the wallet app to sign a (base64) transaction; the page resumes `resume` on return. */
export function linkSignTransaction(w: LinkWallet, base64Tx: string, resume: Resume) {
  const id = newRequest(w, resume);
  go(w, "signTransaction", { ...encrypted(w, { transaction: bs58.encode(b64ToBytes(base64Tx)) }), redirect_link: redirectLink(id) });
}

/** Ask the wallet app to sign a UTF-8 message (sign-in); the page resumes `resume` on return. */
export function linkSignMessage(w: LinkWallet, text: string, resume: Resume) {
  const id = newRequest(w, resume);
  go(w, "signMessage", { ...encrypted(w, { message: bs58.encode(new TextEncoder().encode(text)), display: "utf8" }), redirect_link: redirectLink(id) });
}

export type LinkReturn =
  | { ok: true; wallet: LinkWallet; resume: Resume; publicKey?: string; signedTxBase64?: string; signature?: string }
  | { ok: false; wallet: LinkWallet | null; resume: Resume | null; error: string };

/**
 * If this page load is a redirect back from Phantom, verify and decrypt the
 * reply, consume the pending request, and strip the parameters from the URL.
 */
export function readLinkReturn(): LinkReturn | null {
  if (typeof window === "undefined") return null;
  const u = new URL(window.location.href);
  const id = u.searchParams.get(REQ);
  if (!id) return null;
  const get = (k: string) => u.searchParams.get(k);
  const keyParam = [...u.searchParams.keys()].find((k) => k.endsWith("_encryption_public_key"));
  const p = { pub: keyParam ? get(keyParam) : null, nonce: get("nonce"), data: get("data"), errCode: get("errorCode"), errMsg: get("errorMessage") };
  stripReply(u);
  window.history.replaceState(window.history.state, "", u.pathname + u.search + u.hash);

  const all = read<Record<string, Pending>>(PENDING, {});
  const pending = all[id];
  delete all[id]; // single use
  write(PENDING, all);
  if (!pending || Date.now() - pending.at > TTL) return { ok: false, wallet: null, resume: null, error: "This wallet response doesn't match a request from this browser (or it expired). Nothing was done." };
  const w = pending.wallet;
  const name = LINK_WALLETS[w].name;
  if (p.errCode) return { ok: false, wallet: w, resume: pending, error: /4001|reject/i.test(`${p.errCode} ${p.errMsg}`) ? `You rejected the request in ${name}. Nothing was sent.` : `${name}: ${p.errMsg ?? p.errCode}` };

  const s = read<State | null>(STATE(w), null);
  if (!s || !p.nonce || !p.data) return { ok: false, wallet: w, resume: pending, error: `${name} returned an incomplete response.` };
  try {
    const walletPub = pending.kind === "connect" ? p.pub : s.walletPub;
    if (!walletPub) throw new Error("missing key");
    const shared = nacl.box.before(bs58.decode(walletPub), bs58.decode(s.dappSec));
    const opened = nacl.box.open.after(bs58.decode(p.data), bs58.decode(p.nonce), shared);
    if (!opened) throw new Error("decryption failed");
    const body = JSON.parse(new TextDecoder().decode(opened)) as { public_key?: string; session?: string; transaction?: string; signature?: string };
    if (pending.kind === "connect") {
      if (!body.public_key || !body.session) throw new Error("no account");
      write(STATE(w), { ...s, walletPub, session: body.session, publicKey: body.public_key } satisfies State);
      return { ok: true, wallet: w, resume: pending, publicKey: body.public_key };
    }
    if (body.transaction) return { ok: true, wallet: w, resume: pending, signedTxBase64: bytesToB64(bs58.decode(body.transaction)) };
    if (body.signature) return { ok: true, wallet: w, resume: pending, signature: body.signature };
    throw new Error("empty reply");
  } catch {
    return { ok: false, wallet: w, resume: pending, error: `Couldn't verify ${name}'s response. Nothing was done.` };
  }
}
