import { getChain, isValidAddressFor, type ChainInfo } from "../chains";
import { BadRequest } from "./respond";

export function chainParam(url: URL, name = "chain"): ChainInfo {
  const c = getChain(url.searchParams.get(name));
  if (!c) throw new BadRequest(`Unknown or missing ${name}`);
  return c;
}

export function addressParam(url: URL, chain: ChainInfo, name = "address"): string {
  const a = url.searchParams.get(name)?.trim() ?? "";
  if (!isValidAddressFor(chain, a)) throw new BadRequest(`Invalid ${name} for ${chain.name}`);
  return a;
}
