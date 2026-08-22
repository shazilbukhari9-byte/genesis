// Shared backend config for every feature page's service layer.
// One demo tenant for now, matching how the rest of the app (Subscription's
// SubsAPI, the legacy scripts.ts DB.*) has no real multi-tenant login either.
// API_BASE comes from the environment (see frontend/.env.example) so the
// same built bundle points at whatever backend its deployment configures —
// never a hardcoded host. VITE_API_BASE is required in every real
// deployment; the localhost fallback only covers `npm run dev` when no
// .env has been created yet.
export const API_BASE = import.meta.env.VITE_API_BASE || "http://127.0.0.1:5000";
export const TENANT_ID = "38bfdb29-8845-46e0-ab92-b0b5b43cfd6e";

declare global {
  interface Window {
    __authToken?: string | null;
  }
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const token = window.__authToken;
  const res = await fetch(`${API_BASE}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...init,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}
