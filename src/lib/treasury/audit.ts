import "server-only";
import { q } from "./db";
import { log } from "../server/log";

export interface AuditInput {
  actor?: string | null;
  role?: string | null;
  action: string;
  target?: string | null;
  outcome: "ok" | "denied" | "error" | "pending";
  details?: unknown;
  ip?: string | null;
}

/** Append-only audit trail of every treasury read/write decision. */
export async function audit(a: AuditInput) {
  try {
    await q(
      "insert into audit_log (actor, role, action, target, outcome, details, ip) values ($1,$2,$3,$4,$5,$6,$7)",
      [a.actor ?? null, a.role ?? null, a.action, a.target ?? null, a.outcome, a.details === undefined ? null : JSON.stringify(a.details), a.ip ?? null],
    );
  } catch (e) {
    log("error", "audit write failed", { action: a.action, error: String(e) });
  }
}

export type Severity = "info" | "warning" | "critical";

/**
 * Raise an alert: stored in the database and, if TREASURY_ALERT_WEBHOOK_URL is
 * set, posted to a Slack/Discord-compatible webhook ({ text }).
 */
export async function alert(severity: Severity, kind: string, message: string, details?: unknown) {
  log(severity === "critical" ? "error" : "warn", "treasury alert", { kind, message });
  try {
    await q("insert into alerts (severity, kind, message, details) values ($1,$2,$3,$4)", [severity, kind, message, details === undefined ? null : JSON.stringify(details)]);
  } catch (e) {
    log("error", "alert write failed", { error: String(e) });
  }
  const hook = process.env.TREASURY_ALERT_WEBHOOK_URL;
  if (hook) {
    fetch(hook, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: `[Bajar Treasury · ${severity.toUpperCase()}] ${message}`, content: `[Bajar Treasury · ${severity.toUpperCase()}] ${message}` }),
      signal: AbortSignal.timeout(5000),
    }).catch((e) => log("warn", "alert webhook failed", { error: String(e) }));
  }
}
