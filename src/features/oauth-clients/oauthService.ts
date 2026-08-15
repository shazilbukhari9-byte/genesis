import type { OAuthClient } from "./types";

// Swap the bodies of these functions for real API calls when the backend is
// ready — the page only depends on this contract.

const STORAGE_KEY = "mcm_oauth_clients_v2";
const SIMULATED_LATENCY_MS = 200;

function delay<T>(value: T): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), SIMULATED_LATENCY_MS));
}

function uid(): string {
  return "id" + Math.random().toString(36).slice(2, 10);
}

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
    try {
      return JSON.parse(raw) as OAuthClient[];
    } catch {
      // fall through to defaults
    }
  }
  const data = defaultClients();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  return data;
}

function writeStore(data: OAuthClient[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

export async function fetchOAuthClients(): Promise<OAuthClient[]> {
  return delay(readStore());
}

export async function createOAuthClient(client: Pick<OAuthClient, "name" | "grantType" | "scope" | "tokenDurationSec">): Promise<OAuthClient[]> {
  const data = readStore();
  data.push({
    id: uid(),
    name: client.name,
    grantType: client.grantType,
    clientId: Math.random().toString(36).slice(2, 6) + "…" + Math.random().toString(36).slice(2, 5),
    scope: client.scope,
    tokenDurationSec: client.tokenDurationSec,
    lastUsed: "Never",
    status: "Active",
  });
  writeStore(data);
  return delay(data);
}

export async function revokeOAuthClient(id: string): Promise<OAuthClient[]> {
  const data = readStore().map((c) => (c.id === id ? { ...c, status: "Disabled" as const } : c));
  writeStore(data);
  return delay(data);
}

export async function deleteOAuthClient(id: string): Promise<OAuthClient[]> {
  const data = readStore().filter((c) => c.id !== id);
  writeStore(data);
  return delay(data);
}
