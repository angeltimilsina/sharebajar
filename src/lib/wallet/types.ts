import type { ChainType } from "../types";

export type WalletStatus = "available" | "not-installed" | "coming-soon";

export interface WalletOption {
  id: string;
  name: string;
  icon: string; // data URI or URL
  chainType: ChainType;
  status: WalletStatus;
  installUrl?: string;
  description?: string;
}

export interface ConnectedWallet {
  walletId: string;
  walletName: string;
  chainType: ChainType;
  address: string;
  /** EVM only */
  chainId?: number;
}
