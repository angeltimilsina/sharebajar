// Inline SVG wallet marks (generic, simplified) so nothing loads from third parties.
const svg = (body: string) => `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40">${body}</svg>`)}`;

export const ICONS = {
  bajar: svg(`<rect width="40" height="40" rx="10" fill="#050807"/><rect x="9" y="11" width="22" height="4" rx="1.5" fill="#fff"/><rect x="9" y="18" width="22" height="4" rx="1.5" fill="#00F53A"/><rect x="9" y="25" width="22" height="4" rx="1.5" fill="#fff"/>`),
  phantom: svg(`<rect width="40" height="40" rx="10" fill="#AB9FF2"/><path d="M10 24c0-6.6 4.9-12 11-12s10 4.6 10 10.4c0 3.9-2.6 6.6-5.4 6.6-1.2 0-2-.6-2.4-1.4-.6 1-1.7 1.4-2.8 1.4-1.3 0-2.2-.7-2.6-1.6-.6 1-1.6 1.6-2.8 1.6-2.4 0-3-2.7-3-5z" fill="#fff"/><circle cx="20" cy="21" r="1.6" fill="#AB9FF2"/><circle cx="25" cy="21" r="1.6" fill="#AB9FF2"/>`),
  solflare: svg(`<rect width="40" height="40" rx="10" fill="#FC7227"/><circle cx="20" cy="20" r="8" fill="none" stroke="#fff" stroke-width="3"/><circle cx="20" cy="20" r="3" fill="#fff"/>`),
  backpack: svg(`<rect width="40" height="40" rx="10" fill="#E33E3F"/><rect x="12" y="14" width="16" height="16" rx="4" fill="#fff"/><rect x="16" y="10" width="8" height="5" rx="2" fill="#fff"/>`),
  metamask: svg(`<rect width="40" height="40" rx="10" fill="#F6851B"/><path d="M10 11l9 6.5-1.7-3.9L10 11zm20 0l-7.3 2.6-1.7 3.9L30 11zM13 26l2.3 3.6 5-1.4V22l-7.3 4zm14 0l-7.3-4v6.2l5 1.4L27 26z" fill="#fff"/>`),
  evm: svg(`<rect width="40" height="40" rx="10" fill="#1d2630"/><path d="M20 8l-7 12 7 4 7-4-7-12zm0 18l-7-4 7 10 7-10-7 4z" fill="#8A92B2"/>`),
};
