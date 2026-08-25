import type { Queue, RecordingPolicy } from "./types";
import { apiFetch } from "../shared/backend";

// Backed by the real `recording_policies` table via the generic
// /api/recording-policies resource registered in backend/resources.py
// (fields: tenant_id, name, media, queues, retention, pct, active).
// tenant_id is injected server-side from the auth token — never sent here.
interface BackendRecordingPolicy {
  id: number;
  name: string;
  media: string[] | null;
  queues: string[] | null;
  retention: number;
  pct: number;
  active: boolean;
}

interface BackendQueue {
  id: number;
  name: string;
}

function fromBackend(p: BackendRecordingPolicy): RecordingPolicy {
  return {
    id: String(p.id),
    name: p.name,
    media: p.media ?? [],
    queues: p.queues ?? [],
    retention: p.retention,
    pct: p.pct,
    active: p.active,
  };
}

function toBackend(p: Omit<RecordingPolicy, "id">): Record<string, unknown> {
  return {
    name: p.name,
    media: p.media,
    queues: p.queues,
    retention: p.retention,
    pct: p.pct,
    active: p.active,
  };
}

function logAudit(action: string, detail: string): void {
  const win = window as unknown as {
    DB?: { audit?: { t: string; who: string; act: string; obj?: string }[] };
    APP?: { user?: { name?: string } };
  };
  if (!win.DB) return;
  if (!win.DB.audit) win.DB.audit = [];
  const now = new Date();
  const t =
    now.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) +
    " " +
    now.toTimeString().slice(0, 5);
  win.DB.audit.unshift({ t, who: win.APP?.user?.name ?? "Admin", act: action, obj: detail });
}

export async function fetchRecordingPolicies(): Promise<RecordingPolicy[]> {
  const rows = await apiFetch<BackendRecordingPolicy[]>("/api/recording-policies?limit=500");
  return rows.map(fromBackend);
}

export async function fetchQueuesForPolicies(): Promise<Queue[]> {
  const rows = await apiFetch<BackendQueue[]>("/api/queues?limit=500");
  return rows.map((q) => ({ id: String(q.id), name: q.name }));
}

export async function upsertRecordingPolicy(
  policy: Omit<RecordingPolicy, "id"> & { id?: string },
): Promise<RecordingPolicy[]> {
  const payload = toBackend(policy);
  if (policy.id) {
    await apiFetch(`/api/recording-policies/${policy.id}`, { method: "PUT", body: JSON.stringify(payload) });
    logAudit("Edit recording policy", policy.name);
  } else {
    await apiFetch("/api/recording-policies", { method: "POST", body: JSON.stringify(payload) });
    logAudit("Create recording policy", policy.name);
  }
  return fetchRecordingPolicies();
}

export async function deleteRecordingPolicy(id: string): Promise<RecordingPolicy[]> {
  await apiFetch(`/api/recording-policies/${id}`, { method: "DELETE" });
  logAudit("Delete recording policy", `policy #${id}`);
  return fetchRecordingPolicies();
}
