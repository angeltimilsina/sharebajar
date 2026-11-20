// Wallet logos: official marks self-hosted under /logos/wallets (see scripts/build-logos.mjs); Bajar uses its own mark.
const svg = (body: string) => `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40">${body}</svg>`)}`;

export const ICONS = {
  bajar: svg(`<rect width="40" height="40" rx="10" fill="#000000"/><rect x="9" y="11" width="22" height="4.5" rx="2.25" fill="#f2f1ec"/><rect x="9" y="17.75" width="22" height="4.5" rx="2.25" fill="#3ccf72"/><rect x="9" y="24.5" width="22" height="4.5" rx="2.25" fill="#f2f1ec"/>`),
  phantom: "/logos/wallets/phantom.svg",
  solflare: "/logos/wallets/solflare.svg",
  backpack: "/logos/wallets/backpack.svg",
  metamask: "/logos/wallets/metamask.svg",
  evm: "/logos/networks/ethereum.svg",
};
