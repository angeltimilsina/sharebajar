"use client";
import nacl from "tweetnacl";
import bs58 from "bs58";

/**
 * Phantom deep-link protocol (https://docs.phantom.com/phantom-deeplinks):
 * on phones, the browser asks the Phantom app to connect or sign, Phantom
 * shows the request, then redirects back to this page with an encrypted
 * reply. No extension, and the user stays in their own browser.
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
export const PHANTOM_MOBILE = "phantom-mobile";
const STATE = "bajar.phantom.v1";
const PENDING = "bajar.phantom.pending.v1";
const TTL = 15 * 60_000;
const BASE = "https://phantom.app/ul/v1";
const RETURN_PARAMS = ["phantom_req", "phantom_encryption_public_key", "nonce", "data", "errorCode", "errorMessage"];

interface State { dappPub: string; dappSec: string; phantomPub?: string; session?: string; publicKey?: string }
export type Resume =
  | { kind: "connect" }
  | { kind: "swap"; route: "build" | "order"; requestId: string | null; intentToken?: string | null; summary: string; assetHref?: string; activityKind: "swap" | "trade" }
  | { kind: "signin" };
type Pending = Resume & { at: number };

const read = <T,>(k: string, d: T): T => { try { return JSON.parse(localStorage.getItem(k) ?? "null") ?? d; } catch { return d; } };
const write = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage blocked */ } };
const b64ToBytes = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const bytesToB64 = (u: Uint8Array) => { let s = ""; u.forEach((b) => (s += String.fromCharCode(b))); return btoa(s); };

/** Connected Phantom account (from a previous deep-link connect), if any. */
export function phantomSession(): { publicKey: string } | null {
  const s = read<State | null>(STATE, null);
  return s?.session && s.publicKey ? { publicKey: s.publicKey } : null;
}
export function clearPhantomSession() { try { localStorage.removeItem(STATE); localStorage.removeItem(PENDING); } catch { /* ignore */ } }

function newRequest(r: Resume): string {
  const id = bs58.encode(nacl.randomBytes(12));
  const all = read<Record<string, Pending>>(PENDING, {});
  for (const [k, v] of Object.entries(all)) if (Date.now() - v.at > TTL) delete all[k];
  all[id] = { ...r, at: Date.now() };
  write(PENDING, all);
  return id;
}

function redirectLink(id: string): string {
  const u = new URL(window.location.href);
  for (const p of RETURN_PARAMS) u.searchParams.delete(p);
  u.searchParams.set("phantom_req", id);
  u.hash = "";
  return u.toString();
}

function go(method: string, params: Record<string, string>) {
  window.location.href = `${BASE}/${method}?${new URLSearchParams(params).toString()}`;
}

/** Ask Phantom to connect; it redirects back here with the account. */
export function phantomConnect() {
  const kp = nacl.box.keyPair();
  write(STATE, { dappPub: bs58.encode(kp.publicKey), dappSec: bs58.encode(kp.secretKey) } satisfies State);
  const id = newRequest({ kind: "connect" });
  go("connect", { app_url: window.location.origin, dapp_encryption_public_key: bs58.encode(kp.publicKey), redirect_link: redirectLink(id), cluster: "mainnet-beta" });
}

function encrypted(payload: object) {
  const s = read<State | null>(STATE, null);
  if (!s?.session || !s.phantomPub) throw new Error("Phantom isn't connected. Connect again.");
  const shared = nacl.box.before(bs58.decode(s.phantomPub), bs58.decode(s.dappSec));
  const nonce = nacl.randomBytes(24);
  const box = nacl.box.after(new TextEncoder().encode(JSON.stringify({ ...payload, session: s.session })), nonce, shared);
  return { dapp_encryption_public_key: s.dappPub, nonce: bs58.encode(nonce), payload: bs58.encode(box) };
}

/** Ask Phantom to sign a (base64) transaction; the page resumes `resume` on return. */
export function phantomSignTransaction(base64Tx: string, resume: Resume) {
  const id = newRequest(resume);
  go("signTransaction", { ...encrypted({ transaction: bs58.encode(b64ToBytes(base64Tx)) }), redirect_link: redirectLink(id) });
}

/** Ask Phantom to sign a UTF-8 message (sign-in); the page resumes `resume` on return. */
export function phantomSignMessage(text: string, resume: Resume) {
  const id = newRequest(resume);
  go("signMessage", { ...encrypted({ message: bs58.encode(new TextEncoder().encode(text)), display: "utf8" }), redirect_link: redirectLink(id) });
}

export type PhantomReturn =
  | { ok: true; resume: Resume; publicKey?: string; signedTxBase64?: string; signature?: string }
  | { ok: false; resume: Resume | null; error: string };

/**
 * If this page load is a redirect back from Phantom, verify and decrypt the
 * reply, consume the pending request, and strip the parameters from the URL.
 */
export function readPhantomReturn(): PhantomReturn | null {
  if (typeof window === "undefined") return null;
  const u = new URL(window.location.href);
  const id = u.searchParams.get("phantom_req");
  if (!id) return null;
  const get = (k: string) => u.searchParams.get(k);
  const p = { pub: get("phantom_encryption_public_key"), nonce: get("nonce"), data: get("data"), errCode: get("errorCode"), errMsg: get("errorMessage") };
  for (const k of RETURN_PARAMS) u.searchParams.delete(k);
  window.history.replaceState(window.history.state, "", u.pathname + u.search + u.hash);

  const all = read<Record<string, Pending>>(PENDING, {});
  const pending = all[id];
  delete all[id]; // single use
  write(PENDING, all);
  if (!pending || Date.now() - pending.at > TTL) return { ok: false, resume: null, error: "This Phantom response doesn't match a request from this browser (or it expired). Nothing was done." };
  if (p.errCode) return { ok: false, resume: pending, error: /4001|reject/i.test(`${p.errCode} ${p.errMsg}`) ? "You rejected the request in Phantom. Nothing was sent." : `Phantom: ${p.errMsg ?? p.errCode}` };

  const s = read<State | null>(STATE, null);
  if (!s || !p.nonce || !p.data) return { ok: false, resume: pending, error: "Phantom returned an incomplete response." };
  try {
    const phantomPub = pending.kind === "connect" ? p.pub : s.phantomPub;
    if (!phantomPub) throw new Error("missing key");
    const shared = nacl.box.before(bs58.decode(phantomPub), bs58.decode(s.dappSec));
    const opened = nacl.box.open.after(bs58.decode(p.data), bs58.decode(p.nonce), shared);
    if (!opened) throw new Error("decryption failed");
    const body = JSON.parse(new TextDecoder().decode(opened)) as { public_key?: string; session?: string; transaction?: string; signature?: string };
    if (pending.kind === "connect") {
      if (!body.public_key || !body.session) throw new Error("no account");
      write(STATE, { ...s, phantomPub, session: body.session, publicKey: body.public_key } satisfies State);
      return { ok: true, resume: pending, publicKey: body.public_key };
    }
    if (body.transaction) return { ok: true, resume: pending, signedTxBase64: bytesToB64(bs58.decode(body.transaction)) };
    if (body.signature) return { ok: true, resume: pending, signature: body.signature };
    throw new Error("empty reply");
  } catch {
    return { ok: false, resume: pending, error: "Couldn't verify Phantom's response. Nothing was done." };
  }
}
