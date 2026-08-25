// Shared backend config for every feature page's service layer.
// One demo tenant for now, matching how the rest of the app (Subscription's
// SubsAPI, the legacy scripts.ts DB.*) has no real multi-tenant login either.
// Defaults to the deployed backend so every other developer's build keeps
// working untouched. Override locally via frontend/.env.local (gitignored) —
// VITE_API_BASE=http://localhost:5000 — to point this dev server at your
// own local backend + database instead.
export const API_BASE = import.meta.env["VITE_API_BASE"] || "https://genesis-yysv.onrender.com";
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
