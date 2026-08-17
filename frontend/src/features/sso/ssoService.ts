import type { SsoProvider } from "./types";

// Swap the bodies of these functions for real API calls when the backend is
// ready — the page only depends on this contract.

const STORAGE_KEY = "mcm_sso_providers_v2";
const SIMULATED_LATENCY_MS = 200;

function delay<T>(value: T): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), SIMULATED_LATENCY_MS));
}

function uid(): string {
  return "id" + Math.random().toString(36).slice(2, 10);
}

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
    try {
      return JSON.parse(raw) as SsoProvider[];
    } catch {
      // fall through to defaults
    }
  }
  const data = defaultProviders();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  return data;
}

function writeStore(data: SsoProvider[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

export async function fetchSsoProviders(): Promise<SsoProvider[]> {
  return delay(readStore());
}

export async function upsertSsoProvider(provider: Omit<SsoProvider, "id"> & { id?: string }): Promise<SsoProvider[]> {
  const data = readStore();
  if (provider.id) {
    const idx = data.findIndex((p) => p.id === provider.id);
    if (idx >= 0) data[idx] = { ...data[idx], ...provider, id: provider.id };
  } else {
    data.push({ ...provider, id: uid() });
  }
  writeStore(data);
  return delay(data);
}

export async function deleteSsoProvider(id: string): Promise<SsoProvider[]> {
  const data = readStore().filter((p) => p.id !== id);
  writeStore(data);
  return delay(data);
}
