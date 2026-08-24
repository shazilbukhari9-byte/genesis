// Shared backend config for every feature page's service layer.
// One demo tenant for now, matching how the rest of the app (Subscription's
// SubsAPI, the legacy scripts.ts DB.*) has no real multi-tenant login either.
// API_BASE comes from the environment (see frontend/.env.example) so a
// different deployment can point the same built bundle at a different
// backend by setting VITE_API_BASE — but the *default*, when that variable
// is not configured, is this app's real production backend, never
// localhost. An unset VITE_API_BASE in Vercel's project settings previously
// fell back to http://127.0.0.1:5000, which is only ever reachable on the
// machine running the browser — every real visitor's request went to their
// own computer instead of the backend, surfacing as a 401 "invalid or
// expired token" (or a network error) for everyone. Local dev overrides
// this via frontend/.env (see frontend/.env.example).
export const API_BASE = import.meta.env.VITE_API_BASE || "https://genesis-yysv.onrender.com";
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
