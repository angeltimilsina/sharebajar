import { ShieldAlert, ShieldCheck, Shield, CheckCircle2, XCircle } from "lucide-react";
import type { RiskReport } from "@/lib/security/risk";
import type { TokenInfo } from "@/lib/market/geckoterminal";
import { Badge, Card, CardHeader } from "../ui/primitives";
import { shortAddress } from "@/lib/format";

export function RiskPanel({ report, error, info }: { report: RiskReport | null; error?: string | null; info?: TokenInfo | null }) {
  const level = report?.level ?? "unknown";
  const Icon = level === "low" ? ShieldCheck : level === "high" ? ShieldAlert : Shield;
  const tone = level === "low" ? "up" : level === "high" ? "down" : level === "medium" ? "warn" : "neutral";
  return (
    <Card>
      <CardHeader title="Security & Risk" icon={<Icon size={16} className={level === "low" ? "text-up" : level === "high" ? "text-down" : "text-warn"} />} action={report && <Badge tone={tone as "up" | "down" | "warn" | "neutral"}>{level === "unknown" ? "Unrated" : `${level.toUpperCase()} RISK · ${report.score}/100`}</Badge>} sub="Automated contract checks by GoPlus" />
      <div className="px-4 pb-4">
        {!report && <p className="text-xs text-muted">{error ? `Security data unavailable: ${error}` : "No security data available for this token yet."}</p>}
        {report && (
          <>
            <div className="h-1.5 rounded-full bg-surface-3 overflow-hidden mb-3">
              <div className={`h-full ${level === "low" ? "bg-up" : level === "medium" ? "bg-warn" : "bg-down"}`} style={{ width: `${Math.max(4, report.score)}%` }} />
            </div>
            <ul className="space-y-1.5 text-[13px]">
              {report.flags.slice(0, 12).map((f) => (
                <li key={f.key} className="flex items-start gap-2">
                  {f.ok ? <CheckCircle2 size={15} className="text-up shrink-0 mt-0.5" /> : <XCircle size={15} className={`${f.severity === "high" ? "text-down" : "text-warn"} shrink-0 mt-0.5`} />}
                  <span className="flex-1">{f.label}{f.detail && <span className="text-muted"> — {f.detail}</span>}</span>
                </li>
              ))}
            </ul>
            {(report.buyTax !== null || report.sellTax !== null) && <div className="mt-3 text-xs text-muted num">Buy tax {report.buyTax?.toFixed(1) ?? "—"}% · Sell tax {report.sellTax?.toFixed(1) ?? "—"}%</div>}
          </>
        )}
        {info && (info.mintAuthority || info.freezeAuthority) && (
          <div className="mt-3 text-xs text-muted">GeckoTerminal: mint authority <b className="text-fg">{info.mintAuthority}</b> · freeze authority <b className="text-fg">{info.freezeAuthority}</b>{info.developerHoldingPct !== null ? <> · dev holds <b className="text-fg">{info.developerHoldingPct}%</b></> : null}</div>
        )}
        <p className="mt-3 text-[10.5px] text-faint leading-relaxed">Automated heuristics can miss risks or flag legitimate features. Always do your own research.</p>
      </div>
    </Card>
  );
}

export function HolderPanel({ report, info }: { report: RiskReport | null; info: TokenInfo | null }) {
  const d = info?.holders;
  const seg = d && d.top10 !== null ? [
    { label: "Top 10", v: d.top10 ?? 0, c: "var(--down)" }, { label: "11–20", v: d.top11to20 ?? 0, c: "var(--warn)" },
    { label: "21–40", v: d.top21to40 ?? 0, c: "var(--ai)" }, { label: "Rest", v: d.rest ?? 0, c: "var(--up)" },
  ] : null;
  const holders = report?.holders.slice(0, 10) ?? [];
  const count = d?.count ?? report?.holderCount ?? null;
  return (
    <Card>
      <CardHeader title="Holder Concentration" sub={count ? `${count.toLocaleString()} holders` : undefined} />
      <div className="px-4 pb-4 space-y-3">
        {seg && (
          <div>
            <div className="flex h-2.5 rounded-full overflow-hidden">{seg.map((x) => <div key={x.label} style={{ width: `${x.v}%`, background: x.c }} title={`${x.label}: ${x.v.toFixed(1)}%`} />)}</div>
            <div className="grid grid-cols-4 gap-1 mt-1.5 text-[11px] num">{seg.map((x) => <div key={x.label}><span className="inline-block h-2 w-2 rounded-sm mr-1" style={{ background: x.c }} />{x.label} <b>{x.v.toFixed(1)}%</b></div>)}</div>
          </div>
        )}
        {holders.length > 0 && (
          <table className="w-full text-[12px] num">
            <thead className="text-faint"><tr><th className="text-left font-normal py-1">#</th><th className="text-left font-normal">Wallet</th><th className="text-right font-normal">Share</th></tr></thead>
            <tbody>
              {holders.map((h, i) => (
                <tr key={h.address + i}>
                  <td className="py-0.5 text-muted">{i + 1}</td>
                  <td>{shortAddress(h.address, 5, 5)} {h.isLocked && <Badge tone="up">Locked</Badge>} {h.isContract && <Badge>Contract</Badge>} {h.tag && <Badge tone="info">{h.tag.slice(0, 16)}</Badge>}</td>
                  <td className="text-right">{h.percent.toFixed(2)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {!seg && !holders.length && <p className="text-xs text-muted">Holder data not available for this token.</p>}
      </div>
    </Card>
  );
}
