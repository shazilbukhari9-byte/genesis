import { apiFetch } from "../shared/backend";
import type { AuditEntry } from "./types";

// -----------------------------------------------------------------------------
// Data access layer for the Audit Log.
//
// Backed by the real /api/subscription/audit endpoint (tenant-scoped
// audit_log table), which every already-modernized admin module writes to
// on create/update/delete — Alerts, Contact Lists, DNC Lists, Certificates,
// Apps, Canned Responses, Data Actions, Subscription, plus the generic
// resources.py registry (People, Roles, Groups, Skills/Languages, Divisions,
// and everything else under it) and SSO/OAuth Clients/Organization
// Settings/Authorized Organizations, all wired up alongside this page.
//
// Previously this read `window.DB.audit`, the legacy engine's in-memory-only
// event log — real backend actions never appeared there and everything
// shown was lost on refresh. The legacy engine's own dozens of `audit()`
// call sites (sign-in, and most of the app outside the modules above) still
// only reach that local log, not this real one — see the People &
// Permissions page's `logAudit()` in store.ts for the same still-local
// pattern, left in place since it's otherwise harmless.
// -----------------------------------------------------------------------------

interface BackendAuditRow {
  id: number;
  who: string;
  action: string;
  detail: string | null;
  created_at: string;
}

function formatWhen(createdAt: string): string {
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return createdAt;
  const datePart = date.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
  const timePart = date.toTimeString().slice(0, 5);
  return `${datePart} ${timePart}`;
}

export async function fetchAuditLog(): Promise<AuditEntry[]> {
  const rows = await apiFetch<BackendAuditRow[]>("/api/subscription/audit");
  return rows.map(
    (row): AuditEntry => ({
      when: formatWhen(row.created_at),
      who: row.who,
      action: row.action,
      ...(row.detail ? { detail: row.detail } : {}),
    }),
  );
}
