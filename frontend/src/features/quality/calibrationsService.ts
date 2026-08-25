import type { Calibration, CalibrationEvaluator, CalibStatus, PersonOption } from "./calibTypes";
import { apiFetch } from "../shared/backend";

// Matches the fixed 5-division set used across the rest of the app (see
// certs-redesign.ts / dataact-redesign.ts / contactlists-redesign.ts) — a
// simple free-text tag, not a normalised FK (same reasoning as
// users.division / queues.division in database/schema.sql).
export const CALIB_DIVISIONS: { code: string; label: string }[] = [
  { code: "d_home", label: "Home" },
  { code: "d_ret", label: "UK Retail" },
  { code: "d_dig", label: "UK Digital" },
  { code: "d_col", label: "UK Collections" },
  { code: "d_man", label: "Partner — Manila" },
];

// Real `calibrations` table via /api/calibrations (fields: tenant_id, name,
// form_ref, interaction_ref, division, status, evaluators[JSONB list],
// notes). form_ref/interaction_ref are plain TEXT columns, not real FKs (see
// database/schema.sql's comment on this table) — the pickers below fetch
// real forms/interactions/people to fill them with meaningful values, but
// the column itself stores whatever text ends up there.
interface BackendCalibration {
  id: number;
  name: string;
  form_ref: string | null;
  interaction_ref: string | null;
  division: string | null;
  status: string;
  evaluators: CalibrationEvaluator[] | null;
  notes: string | null;
  due_date: string | null;
  hide_scores_until_complete: boolean | null;
  include_agent_self_assessment: boolean | null;
  notify_evaluators_by_email: boolean | null;
}

const STATUSES: CalibStatus[] = ["Scheduled", "In Progress", "Review Variance", "Completed"];

// Flask's default JSON encoder serializes a Postgres DATE column as an
// RFC-822 string ("Mon, 31 Aug 2026 00:00:00 GMT"), not YYYY-MM-DD — an
// <input type="date"> silently rejects anything else, so this normalizes
// before the value ever reaches the form.
function toDateInputValue(raw: string | null): string {
  if (!raw) return "";
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString().slice(0, 10);
}

function fromBackend(c: BackendCalibration): Calibration {
  return {
    id: String(c.id),
    name: c.name,
    formRef: c.form_ref ?? "",
    interactionRef: c.interaction_ref ?? "",
    division: c.division ?? "",
    status: STATUSES.includes(c.status as CalibStatus) ? (c.status as CalibStatus) : "Scheduled",
    evaluators: c.evaluators ?? [],
    notes: c.notes ?? "",
    dueDate: toDateInputValue(c.due_date),
    hideScoresUntilComplete: c.hide_scores_until_complete ?? true,
    includeAgentSelfAssessment: c.include_agent_self_assessment ?? false,
    notifyEvaluatorsByEmail: c.notify_evaluators_by_email ?? true,
  };
}

export async function fetchCalibrations(): Promise<Calibration[]> {
  const rows = await apiFetch<BackendCalibration[]>("/api/calibrations?limit=500");
  return rows.map(fromBackend);
}

export async function upsertCalibration(
  c: Omit<Calibration, "id"> & { id?: string },
): Promise<Calibration[]> {
  const payload = {
    name: c.name,
    form_ref: c.formRef,
    interaction_ref: c.interactionRef,
    division: c.division,
    status: c.status,
    evaluators: c.evaluators,
    notes: c.notes,
    due_date: c.dueDate || null,
    hide_scores_until_complete: c.hideScoresUntilComplete,
    include_agent_self_assessment: c.includeAgentSelfAssessment,
    notify_evaluators_by_email: c.notifyEvaluatorsByEmail,
  };
  if (c.id) {
    await apiFetch(`/api/calibrations/${c.id}`, { method: "PUT", body: JSON.stringify(payload) });
  } else {
    await apiFetch("/api/calibrations", { method: "POST", body: JSON.stringify(payload) });
  }
  return fetchCalibrations();
}

export async function deleteCalibration(id: string): Promise<Calibration[]> {
  await apiFetch(`/api/calibrations/${id}`, { method: "DELETE" });
  return fetchCalibrations();
}

interface BackendPerson {
  id: number;
  name: string;
}

export async function fetchPeopleForCalibration(): Promise<PersonOption[]> {
  const rows = await apiFetch<BackendPerson[]>("/api/people?limit=500");
  return rows.map((p) => ({ id: String(p.id), name: p.name }));
}

export interface GroupOption {
  id: string;
  name: string;
  memberIds: string[];
}

// Real `people_groups` table via /api/groups — members is a JSONB list of
// /api/people row ids (see people-permissions/store.ts's Group.members),
// so "Add group" below resolves each id against the people already fetched
// for this drawer rather than a separate lookup.
interface BackendGroup {
  id: number;
  name: string;
  members: string[] | null;
}

export async function fetchGroupsForCalibration(): Promise<GroupOption[]> {
  const rows = await apiFetch<BackendGroup[]>("/api/groups?limit=500");
  return rows.map((g) => ({ id: String(g.id), name: g.name, memberIds: g.members ?? [] }));
}

interface BackendEvalForm {
  id: number;
  name: string;
}

export async function fetchFormNamesForCalibration(): Promise<string[]> {
  const rows = await apiFetch<BackendEvalForm[]>("/api/eval-forms?limit=500");
  return rows.map((f) => f.name);
}

interface BackendInteraction {
  id: string;
  customer_name: string | null;
  agent_name: string | null;
  queue_name: string | null;
}

export interface InteractionOption {
  id: string;
  label: string;
  agentName: string | null;
}

export async function fetchInteractionsForCalibration(): Promise<InteractionOption[]> {
  const res = await apiFetch<{ data: BackendInteraction[] }>("/api/interactions?limit=50");
  return res.data.map((i) => ({
    id: i.id,
    label: `${i.customer_name ?? "—"} · ${i.agent_name ?? "—"} · ${i.queue_name ?? "—"}`,
    agentName: i.agent_name,
  }));
}

// Variance = spread between the highest and lowest score among evaluators
// who have actually submitted one; needs at least 2 scored evaluators to
// mean anything.
export function computeVariance(evaluators: CalibrationEvaluator[]): number | null {
  const scores = evaluators.map((e) => e.score).filter((s): s is number => s !== null);
  if (scores.length < 2) return null;
  return Math.max(...scores) - Math.min(...scores);
}

// Variance above this many points between the highest and lowest evaluator
// score flags a completed calibration for review instead of marking it done
// outright — evaluators disagreed enough that it's worth a second look.
const REVIEW_VARIANCE_THRESHOLD = 7;

export function computedStatus(evaluators: CalibrationEvaluator[]): CalibStatus {
  if (evaluators.length === 0) return "Scheduled";
  if (!evaluators.every((e) => e.score !== null)) return "In Progress";
  const variance = computeVariance(evaluators);
  if (variance !== null && variance > REVIEW_VARIANCE_THRESHOLD) return "Review Variance";
  return "Completed";
}
