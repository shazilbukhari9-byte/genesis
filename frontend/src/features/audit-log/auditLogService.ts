import type { AuditEntry } from "./types";

// -----------------------------------------------------------------------------
// Data access layer for the Audit Log.
//
// The page only calls fetchAuditLog() below — swapping it for a real
// `fetch('/api/audit-log')` call later is the only change needed to go live;
// nothing in the UI layer has to change.
//
// For now it reads the same in-memory event log the rest of this prototype
// already writes to on every sign-in, edit, export, etc. (`window.DB.audit`),
// so the log reflects real activity from this session instead of static
// fixtures.
// -----------------------------------------------------------------------------

const SIMULATED_LATENCY_MS = 200;

interface LegacyAuditRow {
  t: string;
  who: string;
  act: string;
  obj?: string;
}

function readLegacyAuditLog(): LegacyAuditRow[] {
  const db = (window as unknown as { DB?: { audit?: LegacyAuditRow[] } }).DB;
  return db?.audit ?? [];
}

export async function fetchAuditLog(): Promise<AuditEntry[]> {
  const rows = readLegacyAuditLog().map(
    (row): AuditEntry => ({
      when: row.t,
      who: row.who,
      action: row.act,
      ...(row.obj !== undefined ? { detail: row.obj } : {}),
    }),
  );
  return new Promise((resolve) => setTimeout(() => resolve(rows), SIMULATED_LATENCY_MS));
}
