"use client";
import { encodeFunctionData, parseAbi } from "viem";

/**
 * Create a TOKEN / native-coin pool on the main V2 DEX of each network with
 * the router's addLiquidityETH (it creates the pair if it doesn't exist and
 * sends the LP tokens to the creator). Two transactions: approve the router
 * for exactly the token amount, then add liquidity.
 */
export const V2_ROUTERS: Record<string, { router: `0x${string}`; dex: string }> = {
  ethereum: { router: "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D", dex: "Uniswap V2" },
  base: { router: "0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24", dex: "Uniswap V2" },
  bsc: { router: "0x10ED43C718714eb63d5aA57B78B54704E256024E", dex: "PancakeSwap V2" },
};
const ERC20 = parseAbi(["function approve(address spender, uint256 value) returns (bool)", "function balanceOf(address) view returns (uint256)", "function allowance(address owner, address spender) view returns (uint256)"]);
const ROUTER = parseAbi(["function addLiquidityETH(address token, uint256 amountTokenDesired, uint256 amountTokenMin, uint256 amountETHMin, address to, uint256 deadline) payable returns (uint256, uint256, uint256)"]);

export const approveData = (spender: `0x${string}`, amount: bigint) => encodeFunctionData({ abi: ERC20, functionName: "approve", args: [spender, amount] });
export const balanceOfData = (owner: `0x${string}`) => encodeFunctionData({ abi: ERC20, functionName: "balanceOf", args: [owner] });
/** New pair: the deposit sets the price, so the minimums equal the amounts (a pre-existing pair at another price makes it revert instead of filling at a bad price). */
export const addLiquidityEthData = (token: `0x${string}`, amountToken: bigint, amountNative: bigint, to: `0x${string}`) =>
  encodeFunctionData({ abi: ROUTER, functionName: "addLiquidityETH", args: [token, amountToken, amountToken, amountNative, to, BigInt(Math.floor(Date.now() / 1000) + 20 * 60)] });
