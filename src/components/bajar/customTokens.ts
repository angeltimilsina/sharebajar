"use client";
export interface CustomToken { network: string; token: string; symbol: string; decimals: number }
const KEY = "bajar.tokens.v1";
export function customTokens(): CustomToken[] { try { return JSON.parse(localStorage.getItem(KEY) ?? "[]"); } catch { return []; } }
export function saveCustomTokens(list: CustomToken[]) { try { localStorage.setItem(KEY, JSON.stringify(list.slice(0, 30))); } catch { /* ignore */ } }
