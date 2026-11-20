import "server-only";
import { deflateRawSync, inflateRawSync } from "node:zlib";

/**
 * Stateless token metadata: the JSON is compressed into the URL itself, so it
 * needs no database or storage and can never change. Only used when hosting
 * isn't available; Metaplex limits the URI to 200 bytes, so long fields are
 * dropped (in this order) until it fits.
 */
export interface MetaFields { name: string; symbol: string; description?: string; image?: string; website?: string; twitter?: string; telegram?: string }
const KEYS: [keyof MetaFields, string][] = [["name", "n"], ["symbol", "s"], ["description", "d"], ["image", "i"], ["website", "w"], ["twitter", "t"], ["telegram", "g"]];
const DROP: (keyof MetaFields)[] = ["description", "telegram", "twitter", "website"];

export function encodeCompact(f: MetaFields, base: string, maxLen = 200): { uri: string; dropped: string[] } | null {
  const cur: MetaFields = { ...f };
  const dropped: string[] = [];
  for (let i = 0; i <= DROP.length; i++) {
    const o: Record<string, string> = {};
    for (const [k, short] of KEYS) if (cur[k]) o[short] = cur[k] as string;
    const uri = `${base}/api/launch/metadata/z/${deflateRawSync(Buffer.from(JSON.stringify(o)), { level: 9 }).toString("base64url")}`;
    if (Buffer.byteLength(uri) <= maxLen) return { uri, dropped };
    const k = DROP[i];
    if (k && cur[k]) { dropped.push(k); delete cur[k]; }
  }
  return null;
}

export function decodeCompact(data: string): MetaFields | null {
  if (!/^[A-Za-z0-9_-]{4,400}$/.test(data)) return null;
  try {
    const o = JSON.parse(inflateRawSync(Buffer.from(data, "base64url"), { maxOutputLength: 4000 }).toString("utf8")) as Record<string, string>;
    const f = Object.fromEntries(KEYS.filter(([, s]) => typeof o[s] === "string").map(([k, s]) => [k, o[s]])) as unknown as MetaFields;
    return f.name && f.symbol ? f : null;
  } catch { return null; }
}

/** Metaplex fungible-standard JSON. */
export function toMetaplex(d: MetaFields) {
  return {
    name: d.name, symbol: d.symbol, description: d.description ?? "", ...(d.image ? { image: d.image } : {}),
    extensions: { ...(d.website ? { website: d.website } : {}), ...(d.twitter ? { twitter: d.twitter } : {}), ...(d.telegram ? { telegram: d.telegram } : {}) },
    ...(d.image ? { properties: { files: [{ uri: d.image, type: "image/png" }], category: "image" } } : {}),
  };
}
