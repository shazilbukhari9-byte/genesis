import type { SsoProvider } from "./types";
import { apiFetch } from "../shared/backend";

// ── Backend API (primary) with localStorage fallback ──

const STORAGE_KEY = "mcm_sso_providers_v2";

/* Map backend row → frontend SsoProvider */
function mapFromApi(row: any): SsoProvider {
  return {
    id: String(row.id),
    name: row.name ?? "",
    type: row.protocol === "oidc" ? "OIDC" : row.protocol === "saml" ? "SAML 2.0" : row.protocol ?? "OIDC",
    status: row.enabled ? "Enabled" : "Disabled",
    statusNote: row.domain_hint ? `Domain: ${row.domain_hint}` : undefined,
    certExpiry: undefined,
    users: 0,
    isDefault: false,
  };
}

/* Map frontend SsoProvider → backend write payload */
function mapToApi(p: Partial<SsoProvider> & { id?: string }) {
  const payload: Record<string, any> = {};
  if (p.name !== undefined) payload.name = p.name;
  if (p.type !== undefined) payload.protocol = p.type === "SAML 2.0" ? "saml" : "oidc";
  if (p.status !== undefined) payload.enabled = p.status === "Enabled";
  return payload;
}

/* ── localStorage fallback (same as original) ── */

function defaultProviders(): SsoProvider[] {
  return [
    { id: "sso_entra", name: "Microsoft Entra ID", type: "SAML 2.0", status: "Enabled", certExpiry: "14 Feb 2027", users: 612, isDefault: true },
    { id: "sso_okta", name: "Okta", type: "SAML 2.0", status: "Disabled", users: 0 },
    { id: "sso_ping", name: "PingFederate", type: "SAML 2.0", status: "Not configured", users: 0 },
    { id: "sso_adfs", name: "ADFS", type: "SAML 2.0", status: "Not configured", users: 0 },
    { id: "sso_generic", name: "Generic SAML", type: "SAML 2.0", status: "Not configured", users: 0 },
    { id: "sso_scim", name: "SCIM provisioning", type: "SCIM 2.0", status: "Enabled", statusNote: "612 synced", users: 612 },
    { id: "sso_entra_partner", name: "Entra ID — Partner tenant", type: "SAML 2.0", status: "Enabled", statusNote: "Certificate expires in 21 days", certExpiry: "30 Aug 2026", users: 48 },
  ];
}

function readStore(): SsoProvider[] {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw) {
    try { return JSON.parse(raw) as SsoProvider[]; } catch { /* fall through */ }
  }
  const data = defaultProviders();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  return data;
}

function writeStore(data: SsoProvider[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

/* ── Exported service functions ── */

export async function fetchSsoProviders(): Promise<SsoProvider[]> {
  try {
    const rows = await apiFetch<any[]>("/api/sso/providers");
    const mapped = rows.map(mapFromApi);
    writeStore(mapped);
    return mapped;
  } catch {
    return readStore();
  }
}

export async function upsertSsoProvider(provider: Omit<SsoProvider, "id"> & { id?: string }): Promise<SsoProvider[]> {
  try {
    if (provider.id) {
      await apiFetch(`/api/sso/providers/${provider.id}`, {
        method: "PUT",
        body: JSON.stringify(mapToApi(provider)),
      });
    } else {
      await apiFetch("/api/sso/providers", {
        method: "POST",
        body: JSON.stringify({
          name: provider.name,
          protocol: provider.type === "SAML 2.0" ? "saml" : "oidc",
          enabled: provider.status === "Enabled",
        }),
      });
    }
    return fetchSsoProviders();
  } catch {
    // Fallback to localStorage
    const data = readStore();
    if (provider.id) {
      const idx = data.findIndex((p) => p.id === provider.id);
      if (idx >= 0) data[idx] = { ...data[idx], ...provider, id: provider.id };
    } else {
      data.push({ ...provider, id: "id" + Math.random().toString(36).slice(2, 10) });
    }
    writeStore(data);
    return data;
  }
}

export async function deleteSsoProvider(id: string): Promise<SsoProvider[]> {
  try {
    await apiFetch(`/api/sso/providers/${id}`, { method: "DELETE" });
    return fetchSsoProviders();
  } catch {
    const data = readStore().filter((p) => p.id !== id);
    writeStore(data);
    return data;
  }
}
