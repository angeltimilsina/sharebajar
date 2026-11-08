/**
 * Bajar Wallet security checks (pure functions + small browser helpers).
 * Everything here runs locally; nothing secret is sent anywhere.
 */
import { wordlist } from "@scure/bip39/wordlists/english.js";

/* ---------------------------- Passwords ---------------------------- */

export const MIN_PASSWORD = 12;

const COMMON = new Set([
  "password", "password1", "password123", "123456789012", "qwertyuiop", "iloveyou", "letmein", "welcome", "admin", "bitcoin", "ethereum",
  "solana", "crypto", "wallet", "bajar", "sharebajar", "metamask", "phantom", "passw0rd", "trustno1", "monkey", "dragon", "football", "qwerty123",
]);

export interface PasswordReport { score: 0 | 1 | 2 | 3 | 4; label: string; ok: boolean; issues: string[]; bits: number }

/**
 * Conservative strength estimate (entropy from character classes, with
 * penalties for repeats, sequences, keyboard runs and common words).
 * Wallet creation requires score ≥ 3 and at least MIN_PASSWORD characters.
 */
export function passwordStrength(pw: string, context: string[] = []): PasswordReport {
  const issues: string[] = [];
  if (pw.length < MIN_PASSWORD) issues.push(`Use at least ${MIN_PASSWORD} characters.`);
  let pool = 0;
  if (/[a-z]/.test(pw)) pool += 26;
  if (/[A-Z]/.test(pw)) pool += 26;
  if (/\d/.test(pw)) pool += 10;
  if (/[^A-Za-z0-9]/.test(pw)) pool += 33;
  const unique = new Set(pw).size;
  // Effective length: repeated characters add little.
  const effLen = Math.min(pw.length, unique * 1.5 + (pw.length - unique) * 0.25);
  let bits = effLen * Math.log2(Math.max(pool, 1));
  const lower = pw.toLowerCase();
  if (/(.)\1{2,}/.test(pw)) { bits -= 12; issues.push("Avoid repeated characters (aaa, 111)."); }
  if (/(0123|1234|2345|3456|4567|5678|6789|abcd|bcde|cdef|qwer|wert|asdf|sdfg|zxcv)/.test(lower)) { bits -= 15; issues.push("Avoid sequences and keyboard runs (1234, qwerty)."); }
  const words = lower.split(/[^a-z]+/).filter(Boolean);
  const common = [...COMMON].some((c) => lower.includes(c)) || words.some((w) => COMMON.has(w));
  if (common) { bits -= 25; issues.push("Avoid common words and crypto terms."); }
  // Any 6+ character run shared with an address/name counts as reuse.
  const ctx = context.map((x) => x.toLowerCase()).filter((x) => x.length >= 6);
  let reused = false;
  for (let i = 0; i + 6 <= lower.length && !reused; i++) reused = ctx.some((c) => c.includes(lower.slice(i, i + 6)));
  if (reused) { bits -= 40; issues.push("Don't reuse your address or name in the password."); }
  if (/^\d+$/.test(pw)) { bits -= 10; issues.push("Don't use only numbers."); }
  bits = Math.max(0, Math.round(bits));
  let score = (bits < 35 ? 0 : bits < 50 ? 1 : bits < 65 ? 2 : bits < 85 ? 3 : 4) as PasswordReport["score"];
  // Dictionary-based guessing beats entropy estimates: cap short passwords built on common words / reuse.
  if ((common && pw.length < 20) || reused) score = Math.min(score, 2) as PasswordReport["score"];
  const label = ["Very weak", "Weak", "Fair", "Strong", "Very strong"][score];
  if (score < 3 && !issues.length) issues.push("Make it longer — a phrase of 4+ random words works well.");
  return { score, label, bits, issues, ok: pw.length >= MIN_PASSWORD && score >= 3 };
}

/* ------------------------- Recovery phrases ------------------------ */

/** Phrases published in docs/tests. Funds sent to them are swept by bots within seconds. */
const PUBLIC_PHRASES = new Set([
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about",
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art",
  "test test test test test test test test test test test junk",
  "legal winner thank year wave sausage worth useful legal winner thank yellow",
  "letter advice cage absurd amount doctor acoustic avoid letter advice cage above",
  "zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong",
  "candy maple cake sugar pudding cream honey rich smooth crumble sweet treat",
]);

export interface PhraseReport { words: string[]; invalidWords: number[]; validCount: boolean; checksumOk: boolean; publicPhrase: boolean; lowDiversity: boolean }

export const isBip39Word = (w: string) => wordlist.includes(w);

export function analyzePhrase(input: string, checksumOk: boolean): PhraseReport {
  const words = input.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const invalidWords = words.map((w, i) => (isBip39Word(w) ? -1 : i)).filter((i) => i >= 0);
  const joined = words.join(" ");
  return {
    words, invalidWords,
    validCount: words.length === 12 || words.length === 24,
    checksumOk,
    publicPhrase: PUBLIC_PHRASES.has(joined),
    lowDiversity: words.length >= 12 && new Set(words).size <= words.length / 2,
  };
}

/** Suggest close wordlist matches for a mistyped word (prefix, then edit distance 1). */
export function suggestWords(w: string, max = 3): string[] {
  if (!w) return [];
  const pre = wordlist.filter((x) => x.startsWith(w)).slice(0, max);
  if (pre.length) return pre;
  const d1 = (a: string, b: string) => {
    if (Math.abs(a.length - b.length) > 1) return false;
    let i = 0, j = 0, diff = 0;
    while (i < a.length && j < b.length) {
      if (a[i] === b[j]) { i++; j++; continue; }
      if (++diff > 1) return false;
      if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; }
    }
    return diff + (a.length - i) + (b.length - j) <= 1;
  };
  return wordlist.filter((x) => d1(x, w)).slice(0, max);
}

/** Pick `n` distinct random positions for the backup quiz (crypto RNG). */
export function quizPositions(total: number, n = 3): number[] {
  const out = new Set<number>();
  const buf = new Uint32Array(1);
  while (out.size < Math.min(n, total)) { crypto.getRandomValues(buf); out.add(buf[0] % total); }
  return [...out].sort((a, b) => a - b);
}

/** Shuffled answer chips: the correct word plus decoys from the phrase and the wordlist. */
export function quizChoices(words: string[], position: number, n = 6): string[] {
  const correct = words[position];
  const pool = new Set<string>([correct]);
  const buf = new Uint32Array(1);
  // Distinct decoys from the phrase itself (phrases can repeat words), then from the wordlist.
  const others = [...new Set(words.filter((w) => w !== correct))];
  while (pool.size < Math.min(3, others.length + 1)) { crypto.getRandomValues(buf); pool.add(others[buf[0] % others.length]); }
  while (pool.size < n) { crypto.getRandomValues(buf); pool.add(wordlist[buf[0] % wordlist.length]); }
  const arr = [...pool];
  for (let i = arr.length - 1; i > 0; i--) { crypto.getRandomValues(buf); const j = buf[0] % (i + 1); [arr[i], arr[j]] = [arr[j], arr[i]]; }
  return arr;
}

/* ------------------------- Unlock throttling ----------------------- */

const THROTTLE_KEY = "bajar.unlock.v1";
interface Throttle { fails: number; until: number }

function readThrottle(): Throttle {
  try { return { fails: 0, until: 0, ...JSON.parse(localStorage.getItem(THROTTLE_KEY) ?? "{}") }; } catch { return { fails: 0, until: 0 }; }
}

/** Delay after the n-th consecutive failure: free for 3 tries, then 30s doubling up to 1h. */
export const throttleDelayMs = (fails: number) => (fails < 3 ? 0 : Math.min(3600_000, 30_000 * 2 ** (fails - 3)));

export function unlockBlockedFor(now = Date.now()): number { return Math.max(0, readThrottle().until - now); }
export function unlockFailures(): number { return readThrottle().fails; }
export function recordUnlockFailure(now = Date.now()): number {
  const t = readThrottle();
  const fails = t.fails + 1;
  const until = now + throttleDelayMs(fails);
  try { localStorage.setItem(THROTTLE_KEY, JSON.stringify({ fails, until })); } catch { /* ignore */ }
  return until - now;
}
export function resetUnlockFailures() { try { localStorage.removeItem(THROTTLE_KEY); } catch { /* ignore */ } }

/* ------------------------- Recipient checks ------------------------ */

export type Severity = "info" | "warn" | "danger";
export interface RecipientFlag { severity: Severity; code: string; message: string }

/**
 * Local recipient checks: own address, address poisoning (same first/last
 * characters as an address you used before, but different), first-time
 * recipient, and sending to a token contract.
 */
export function localRecipientChecks(to: string, opts: { own: string[]; history: string[]; tokenAddresses?: string[]; amountShareOfBalance?: number }): RecipientFlag[] {
  const flags: RecipientFlag[] = [];
  const norm = (a: string) => (a.startsWith("0x") ? a.toLowerCase() : a);
  const t = norm(to.trim());
  if (!t) return flags;
  if (opts.own.map(norm).includes(t)) flags.push({ severity: "warn", code: "self", message: "This is your own address." });
  if (opts.tokenAddresses?.map(norm).includes(t)) flags.push({ severity: "danger", code: "token_contract", message: "This is a token contract address. Tokens sent to it are usually lost forever." });
  const hist = [...new Set(opts.history.map(norm))];
  const look = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
  const poison = hist.find((h) => h !== t && h.slice(0, 5) === t.slice(0, 5) && h.slice(-4) === t.slice(-4));
  if (poison) flags.push({ severity: "danger", code: "poisoning", message: `Looks like ${look(poison)} (an address you used before) but is different. This is a common address-poisoning scam — copy the address from the source, not from your history.` });
  else if (hist.length && !hist.includes(t)) flags.push({ severity: "info", code: "first_time", message: "First time sending to this address. Double-check every character." });
  if ((opts.amountShareOfBalance ?? 0) >= 0.5) flags.push({ severity: "warn", code: "large", message: `You are sending ${Math.round((opts.amountShareOfBalance ?? 0) * 100)}% of this balance.` });
  return flags;
}

/* -------------------------- Device checkup ------------------------- */

export interface Check { id: string; label: string; ok: boolean; severity: Severity; detail: string }

export function environmentChecks(): Check[] {
  const w = typeof window !== "undefined" ? window : undefined;
  const secure = !!w?.isSecureContext;
  const framed = !!w && w.top !== w.self;
  const subtle = !!w?.crypto?.subtle;
  return [
    { id: "https", label: "Secure connection (HTTPS)", ok: secure, severity: "danger", detail: secure ? "Encrypted connection with a valid certificate." : "Not a secure context — never use a wallet over plain HTTP." },
    { id: "frame", label: "Not embedded by another site", ok: !framed, severity: "danger", detail: framed ? "This page is inside a frame. Open Bajar directly in its own tab." : "Running in its own top-level tab." },
    { id: "webcrypto", label: "Browser crypto available", ok: subtle, severity: "danger", detail: subtle ? "WebCrypto (AES-GCM) and a secure random source are available." : "WebCrypto is unavailable — update your browser." },
  ];
}
