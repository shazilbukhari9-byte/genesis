import type { OAuthClient } from "./types";
import { apiFetch } from "../shared/backend";

// ── Backend API (primary) with localStorage fallback ──

const STORAGE_KEY = "mcm_oauth_clients_v2";

/* Map backend row → frontend OAuthClient */
function mapFromApi(row: any): OAuthClient {
  const grantMap: Record<string, string> = {
    client_credentials: "Client Credentials",
    authorization_code: "Code Authorization",
    implicit: "Implicit Grant",
  };
  return {
    id: String(row.id),
    name: row.name ?? "",
    grantType: grantMap[row.grant_types] ?? row.grant_types ?? "Client Credentials",
    clientId: row.client_id ?? "",
    scope: row.scopes ?? "read",
    tokenDurationSec: 3600,
    lastUsed: row.updated_at ? new Date(row.updated_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "Never",
    status: row.enabled ? "Active" : "Disabled",
    statusNote: undefined,
  };
}

/* Map frontend fields → backend write payload */
function mapToApi(c: Partial<OAuthClient>) {
  const grantMap: Record<string, string> = {
    "Client Credentials": "client_credentials",
    "Code Authorization": "authorization_code",
    "Implicit Grant": "implicit",
    "SAML2 Bearer": "saml2_bearer",
  };
  const payload: Record<string, any> = {};
  if (c.name !== undefined) payload.name = c.name;
  if (c.grantType !== undefined) payload.grant_types = grantMap[c.grantType] ?? "client_credentials";
  if (c.scope !== undefined) payload.scopes = c.scope;
  if (c.status !== undefined) payload.enabled = c.status === "Active";
  return payload;
}

/* ── localStorage fallback (same as original) ── */

function defaultClients(): OAuthClient[] {
  return [
    { id: "oc_1", name: "MCM Integration Service", grantType: "Client Credentials", clientId: "c4f1…9ab", scope: "Integration Admin (All divisions)", tokenDurationSec: 86400, lastUsed: "Today 09:40", status: "Active" },
    { id: "oc_2", name: "Salesforce Connector", grantType: "Client Credentials", clientId: "7a20…1de", scope: "Data Action Runner", tokenDurationSec: 43200, lastUsed: "Today 09:38", status: "Active" },
    { id: "oc_3", name: "Supervisor Wallboard", grantType: "Implicit Grant", clientId: "ee81…c07", scope: "Analytics Read (UK Retail)", tokenDurationSec: 3600, lastUsed: "Today 09:12", status: "Active" },
    { id: "oc_4", name: "WFM Data Export", grantType: "Client Credentials", clientId: "1bb9…44a", scope: "WFM Read", tokenDurationSec: 86400, lastUsed: "Today 04:00", status: "Active" },
    { id: "oc_5", name: "Mobile Agent App", grantType: "Code Authorization", clientId: "9df3…b62", scope: "Agent", tokenDurationSec: 7200, lastUsed: "Yesterday", status: "Active" },
    { id: "oc_6", name: "Legacy Reporting Job", grantType: "Client Credentials", clientId: "5c77…20f", scope: "Analytics Read", tokenDurationSec: 86400, lastUsed: "14 Apr 2026", status: "Disabled" },
    { id: "oc_7", name: "Partner API — Northstar", grantType: "SAML2 Bearer", clientId: "a8e2…771", scope: "Agent (Partner — Manila)", tokenDurationSec: 3600, lastUsed: "Today 02:15", status: "Active", statusNote: "Secret rotation due" },
  ];
}

function readStore(): OAuthClient[] {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw) {
    try { return JSON.parse(raw) as OAuthClient[]; } catch { /* fall through */ }
  }
  const data = defaultClients();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  return data;
}

function writeStore(data: OAuthClient[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

/* ── Exported service functions ── */

export async function fetchOAuthClients(): Promise<OAuthClient[]> {
  try {
    const rows = await apiFetch<any[]>("/api/oauth/clients");
    const mapped = rows.map(mapFromApi);
    writeStore(mapped);
    return mapped;
  } catch {
    return readStore();
  }
}

export async function createOAuthClient(client: Pick<OAuthClient, "name" | "grantType" | "scope" | "tokenDurationSec">): Promise<OAuthClient[]> {
  try {
    await apiFetch("/api/oauth/clients", {
      method: "POST",
      body: JSON.stringify(mapToApi(client)),
    });
    return fetchOAuthClients();
  } catch {
    // Fallback to localStorage
    const data = readStore();
    data.push({
      id: "id" + Math.random().toString(36).slice(2, 10),
      name: client.name,
      grantType: client.grantType,
      clientId: Math.random().toString(36).slice(2, 6) + "…" + Math.random().toString(36).slice(2, 5),
      scope: client.scope,
      tokenDurationSec: client.tokenDurationSec,
      lastUsed: "Never",
      status: "Active",
    });
    writeStore(data);
    return data;
  }
}

export async function revokeOAuthClient(id: string): Promise<OAuthClient[]> {
  try {
    await apiFetch(`/api/oauth/clients/${id}`, {
      method: "PUT",
      body: JSON.stringify({ enabled: false }),
    });
    return fetchOAuthClients();
  } catch {
    const data = readStore().map((c) => (c.id === id ? { ...c, status: "Disabled" as const } : c));
    writeStore(data);
    return data;
  }
}

export async function deleteOAuthClient(id: string): Promise<OAuthClient[]> {
  try {
    await apiFetch(`/api/oauth/clients/${id}`, { method: "DELETE" });
    return fetchOAuthClients();
  } catch {
    const data = readStore().filter((c) => c.id !== id);
    writeStore(data);
    return data;
  }
}
