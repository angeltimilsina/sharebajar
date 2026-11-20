// Extracts brand logos from open icon sets into public/logos so they are
// self-hosted (no third-party CDN, works under the wallet's strict CSP).
//   tokens/networks/wallets/exchanges: @web3icons/core (MIT)
//   extra coin icons:                   cryptocurrency-icons (CC0)
// Logos are trademarks of their owners and are used only to identify them.
// Run: node scripts/build-logos.mjs
import { readdirSync, readFileSync, mkdirSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = new URL("..", import.meta.url).pathname;
const W3 = join(ROOT, "node_modules/@web3icons/core/dist/svgs");
const CI = join(ROOT, "node_modules/cryptocurrency-icons/svg/color");
const OUT = join(ROOT, "public/logos");
const MAX_BYTES = 24_000; // skip icons with embedded rasters

if (existsSync(OUT)) rmSync(OUT, { recursive: true });
const index = { tokens: [], networks: [], wallets: [], exchanges: [] };

const clean = (svg) => svg.replace(/\sclass="web3icons"/, "").replace(/\n\s*/g, " ").trim();

for (const kind of Object.keys(index)) {
  const dir = join(W3, kind, "branded");
  mkdirSync(join(OUT, kind), { recursive: true });
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".svg.js"))) {
    const name = f.replace(/\.svg\.js$/, "");
    const svg = clean((await import(pathToFileURL(join(dir, f)).href)).default);
    if (svg.length > MAX_BYTES) continue;
    const key = kind === "tokens" ? name.toUpperCase() : name.toLowerCase();
    writeFileSync(join(OUT, kind, `${key}.svg`), svg);
    index[kind].push(key);
  }
}

// Fill gaps in coin icons from cryptocurrency-icons.
let added = 0;
for (const f of readdirSync(CI).filter((x) => x.endsWith(".svg"))) {
  const key = f.replace(/\.svg$/, "").toUpperCase();
  if (index.tokens.includes(key)) continue;
  const svg = readFileSync(join(CI, f), "utf8").trim();
  if (svg.length > MAX_BYTES) continue;
  writeFileSync(join(OUT, "tokens", `${key}.svg`), svg);
  index.tokens.push(key);
  added++;
}

for (const k of Object.keys(index)) index[k].sort();
writeFileSync(join(ROOT, "src/lib/logos-index.json"), JSON.stringify(index));
console.log(Object.entries(index).map(([k, v]) => `${k}: ${v.length}`).join(", "), `(+${added} from cryptocurrency-icons)`);
