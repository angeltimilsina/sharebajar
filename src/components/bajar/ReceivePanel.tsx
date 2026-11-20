"use client";
import { useEffect, useState } from "react";
import { Copy, Check } from "lucide-react";
import QRCode from "qrcode";
import { Card, Notice } from "../ui/primitives";
import { bajar } from "@/lib/bajar/session";

function Addr({ label, uri, address, note }: { label: string; uri: string; address: string; note: string }) {
  const [qr, setQr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => { QRCode.toDataURL(uri, { margin: 1, width: 360 }).then(setQr).catch(() => {}); }, [uri]);
  return (
    <Card className="p-4 flex flex-col items-center text-center gap-2">
      <div className="text-sm font-semibold">{label}</div>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {qr ? <img src={qr} alt={`${label} address QR code`} width={180} height={180} className="rounded-lg bg-white p-1" /> : <div className="h-[180px] w-[180px] rounded-lg bg-surface-2" />}
      <div className="font-mono text-[11px] break-all" data-testid={`bajar-addr-${label.split(" ")[0].toLowerCase()}`}>{address}</div>
      <button className="text-xs text-brand inline-flex items-center gap-1" onClick={() => { navigator.clipboard.writeText(address); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>{copied ? <Check size={12} /> : <Copy size={12} />}{copied ? "Copied" : "Copy"}</button>
      <p className="text-[11px] text-muted">{note}</p>
    </Card>
  );
}

export function ReceivePanel() {
  const a = bajar.accounts()!;
  return (
    <div className="space-y-3">
      <Notice tone="warn">Only send assets on the matching network. Sending to the wrong network can lose funds.</Notice>
      <div className="grid gap-3 sm:grid-cols-3">
        <Addr label="Bitcoin (native SegWit)" uri={`bitcoin:${a.bitcoin.address}`} address={a.bitcoin.address} note={`Native BTC only · ${a.bitcoin.path}`} />
        <Addr label="Ethereum & EVM" uri={`ethereum:${a.evm.address}`} address={a.evm.address} note={`Same address on Ethereum, Base, Arbitrum, Optimism, Polygon, BNB, Avalanche · ${a.evm.path}`} />
        <Addr label="Solana" uri={`solana:${a.solana.address}`} address={a.solana.address} note={`SOL and SPL tokens · ${a.solana.path}`} />
      </div>
    </div>
  );
}
