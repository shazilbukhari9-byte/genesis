import type { Forecast, ForecastGroupData, PlanningGroup, QueueOption, ServiceGoal } from "./forecastTypes";
import { apiFetch } from "../shared/backend";

// Real `planning_groups` / `service_goals` / `forecasts` tables via the
// generic REGISTRY resources — ported from scripts.ts's window.renderForecastFx
// / editPG / editSG / genForecast (legacy vanilla-JS engine), which was
// already a real, working, backend-synced feature — this is a faithful
// React port of that logic, not a redesign.

interface BackendPlanningGroup {
  id: number;
  name: string;
  queues: string[] | null;
  skills: string[] | null;
  langs: string[] | null;
}

function fromBackendPG(p: BackendPlanningGroup): PlanningGroup {
  return { id: String(p.id), name: p.name, queues: p.queues ?? [], skills: p.skills ?? [], langs: p.langs ?? [] };
}

export async function fetchPlanningGroups(): Promise<PlanningGroup[]> {
  const rows = await apiFetch<BackendPlanningGroup[]>("/api/planning-groups?limit=500");
  return rows.map(fromBackendPG);
}

export async function upsertPlanningGroup(
  p: Omit<PlanningGroup, "id"> & { id?: string },
): Promise<PlanningGroup[]> {
  const payload = { name: p.name, queues: p.queues, skills: p.skills, langs: p.langs };
  if (p.id) {
    await apiFetch(`/api/planning-groups/${p.id}`, { method: "PUT", body: JSON.stringify(payload) });
  } else {
    await apiFetch("/api/planning-groups", { method: "POST", body: JSON.stringify(payload) });
  }
  return fetchPlanningGroups();
}

export async function deletePlanningGroup(id: string): Promise<PlanningGroup[]> {
  await apiFetch(`/api/planning-groups/${id}`, { method: "DELETE" });
  return fetchPlanningGroups();
}

interface BackendServiceGoal {
  id: number;
  name: string;
  sl: number;
  sls: number;
  asa: number;
  abn: number;
  pgs: number[] | null;
}

function fromBackendSG(g: BackendServiceGoal): ServiceGoal {
  return { id: String(g.id), name: g.name, sl: g.sl, sls: g.sls, asa: g.asa, abn: g.abn, pgs: (g.pgs ?? []).map(String) };
}

export async function fetchServiceGoals(): Promise<ServiceGoal[]> {
  const rows = await apiFetch<BackendServiceGoal[]>("/api/service-goals?limit=500");
  return rows.map(fromBackendSG);
}

export async function upsertServiceGoal(
  g: Omit<ServiceGoal, "id"> & { id?: string },
): Promise<ServiceGoal[]> {
  const payload = { name: g.name, sl: g.sl, sls: g.sls, asa: g.asa, abn: g.abn, pgs: g.pgs.map(Number) };
  if (g.id) {
    await apiFetch(`/api/service-goals/${g.id}`, { method: "PUT", body: JSON.stringify(payload) });
  } else {
    await apiFetch("/api/service-goals", { method: "POST", body: JSON.stringify(payload) });
  }
  return fetchServiceGoals();
}

export async function deleteServiceGoal(id: string): Promise<ServiceGoal[]> {
  await apiFetch(`/api/service-goals/${id}`, { method: "DELETE" });
  return fetchServiceGoals();
}

interface BackendForecast {
  id: number;
  week: string;
  status: string;
  generated_at: string;
  data: Record<string, ForecastGroupData> | null;
}

function fromBackendForecast(f: BackendForecast): Forecast {
  return { id: String(f.id), week: f.week, status: f.status, generatedAt: f.generated_at, data: f.data ?? {} };
}

export async function fetchForecasts(): Promise<Forecast[]> {
  const rows = await apiFetch<BackendForecast[]>("/api/forecasts?limit=500");
  return rows.map(fromBackendForecast);
}

export async function deleteForecast(id: string): Promise<Forecast[]> {
  await apiFetch(`/api/forecasts/${id}`, { method: "DELETE" });
  return fetchForecasts();
}

export async function fetchQueuesForForecast(): Promise<QueueOption[]> {
  const rows = await apiFetch<{ id: number; name: string }[]>("/api/queues?limit=500");
  return rows.map((q) => ({ id: String(q.id), name: q.name }));
}

interface BackendSimpleEntity {
  id: number;
  name: string;
}

export async function fetchSkillNames(): Promise<string[]> {
  const rows = await apiFetch<BackendSimpleEntity[]>("/api/simple-entities?kind=skill&limit=500");
  return rows.map((s) => s.name);
}

export async function fetchLangNames(): Promise<string[]> {
  const rows = await apiFetch<BackendSimpleEntity[]>("/api/simple-entities?kind=lang&limit=500");
  return rows.map((l) => l.name);
}

export const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
const DAY_WEIGHTS: Record<string, number> = { Mon: 1.15, Tue: 1.05, Wed: 1.0, Thu: 1.0, Fri: 0.95, Sat: 0.55, Sun: 0.3 };

// Same polynomial string hash as scripts.ts's hash() — deterministic per
// planning-group name, used only to seed a believable base volume/AHT so
// re-generating shows stable numbers rather than pure randomness.
function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

// Next Monday, formatted like the legacy "w/c Mon 24 Aug 2026".
export function currentWeekLabel(): string {
  const d = new Date();
  const day = (d.getDay() + 6) % 7;
  const mon = new Date(d);
  mon.setDate(d.getDate() - day + 7);
  return `w/c Mon ${mon.getDate()} ${mon.toLocaleDateString("en-GB", { month: "short" })} ${mon.getFullYear()}`;
}

interface InteractionForForecast {
  queueName: string;
}

async function fetchRecentInteractionQueues(): Promise<InteractionForForecast[]> {
  const res = await apiFetch<{ data: { queue_name: string | null }[] }>("/api/interactions?limit=500");
  return res.data.map((i) => ({ queueName: i.queue_name ?? "" }));
}

// Faithful port of scripts.ts's window.genForecast: deterministic base
// volume/AHT per planning group (seeded from its name), plus a real bump
// from actual interaction history in that group's queues, spread across
// the week using the same fixed day-of-week weighting.
export async function generateForecast(
  planningGroups: PlanningGroup[],
  queues: QueueOption[],
): Promise<{ week: string; status: string; data: Record<string, ForecastGroupData> }> {
  const week = currentWeekLabel();
  const interactions = await fetchRecentInteractionQueues();
  const queueById = new Map(queues.map((q) => [q.id, q.name]));

  const data: Record<string, ForecastGroupData> = {};
  for (const p of planningGroups) {
    const base = 120 + (hash(p.name) % 160);
    const groupQueueNames = new Set(p.queues.map((qid) => queueById.get(qid)).filter(Boolean));
    const handled = interactions.filter((i) => groupQueueNames.has(i.queueName)).length;
    const vol = base + handled * 12;
    const aht = 180 + (hash(p.name) % 140);
    const days: Record<string, number> = {};
    for (const d of DAYS) days[d] = Math.round((vol * (DAY_WEIGHTS[d] ?? 1)) / 5);
    data[p.id] = { vol, aht, days };
  }

  return { week, status: "Generated (ABM)", data };
}

export async function saveForecast(payload: { week: string; status: string; data: Record<string, ForecastGroupData> }): Promise<Forecast[]> {
  await apiFetch("/api/forecasts", { method: "POST", body: JSON.stringify(payload) });
  return fetchForecasts();
}
