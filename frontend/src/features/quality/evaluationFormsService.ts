import type { Answer, EvalForm, EvalRecord, InteractionSummary } from "./evalTypes";
import { apiFetch } from "../shared/backend";

// Form definitions — real `eval_forms` table via /api/eval-forms (fields:
// tenant_id, name, published, groups[JSONB list]).
interface BackendEvalForm {
  id: number;
  name: string;
  published: boolean;
  groups: EvalForm["groups"] | null;
}

function fromBackendForm(f: BackendEvalForm): EvalForm {
  return { id: String(f.id), name: f.name, published: f.published, groups: f.groups ?? [] };
}

export async function fetchEvalForms(): Promise<EvalForm[]> {
  const rows = await apiFetch<BackendEvalForm[]>("/api/eval-forms?limit=500");
  return rows.map(fromBackendForm);
}

export async function upsertEvalForm(
  form: Omit<EvalForm, "id"> & { id?: string },
): Promise<EvalForm[]> {
  const payload = { name: form.name, published: form.published, groups: form.groups };
  if (form.id) {
    await apiFetch(`/api/eval-forms/${form.id}`, { method: "PUT", body: JSON.stringify(payload) });
  } else {
    await apiFetch("/api/eval-forms", { method: "POST", body: JSON.stringify(payload) });
  }
  return fetchEvalForms();
}

export async function deleteEvalForm(id: string): Promise<EvalForm[]> {
  await apiFetch(`/api/eval-forms/${id}`, { method: "DELETE" });
  return fetchEvalForms();
}

// Scored evaluations — the new `evals` table via /api/evals. A failed
// critical question zeroes its whole group and flags the evaluation,
// matching the reference prototype's evScore() behaviour. N/A questions
// are excluded from both the earned and possible totals entirely.
export function computeScore(
  form: EvalForm,
  answers: Record<string, Answer>,
): { pct: number; criticalFail: boolean; earned: number; possible: number } {
  let earned = 0;
  let possible = 0;
  let criticalFail = false;

  for (const group of form.groups) {
    let groupEarned = 0;
    let groupPossible = 0;
    let groupCriticalFailed = false;
    for (const q of group.questions) {
      const ans = answers[q.id];
      if (!ans || ans === "na") continue;
      groupPossible += q.weight;
      if (ans === "yes") groupEarned += q.weight;
      else if (ans === "no" && q.critical) groupCriticalFailed = true;
    }
    if (groupCriticalFailed) {
      groupEarned = 0;
      criticalFail = true;
    }
    earned += groupEarned;
    possible += groupPossible;
  }

  const pct = possible > 0 ? Math.round((earned / possible) * 100) : 0;
  return { pct, criticalFail, earned, possible };
}

interface BackendEval {
  id: number;
  form_id: number | null;
  interaction_id: string | null;
  agent_id: number | null;
  answers: Record<string, Answer> | null;
  pct: number;
  critical_fail: boolean;
  created_at: string;
}

export function fromBackendEval(e: BackendEval, forms: EvalForm[], interactions: InteractionSummary[]): EvalRecord {
  const form = forms.find((f) => f.id === String(e.form_id));
  const interaction = interactions.find((i) => i.id === e.interaction_id);
  const interactionLabel = interaction
    ? `${interaction.customerName} · ${interaction.queueName}`
    : (e.interaction_id ?? "—");
  return {
    id: String(e.id),
    formId: e.form_id !== null ? String(e.form_id) : null,
    formName: form?.name ?? "—",
    interactionId: e.interaction_id,
    interactionLabel,
    agentName: interaction?.agentName ?? "—",
    answers: e.answers ?? {},
    pct: e.pct,
    criticalFail: e.critical_fail,
    createdAt: e.created_at,
  };
}

export async function fetchRawEvals(): Promise<BackendEval[]> {
  return apiFetch<BackendEval[]>("/api/evals?limit=20");
}

export async function submitEval(payload: {
  formId: string;
  interactionId: string;
  answers: Record<string, Answer>;
  pct: number;
  criticalFail: boolean;
}): Promise<void> {
  await apiFetch("/api/evals", {
    method: "POST",
    body: JSON.stringify({
      form_id: Number(payload.formId),
      interaction_id: payload.interactionId,
      answers: payload.answers,
      pct: payload.pct,
      critical_fail: payload.criticalFail,
    }),
  });
}

interface BackendInteraction {
  id: string;
  customer_name: string | null;
  agent_id: number | null;
  agent_name: string | null;
  queue_name: string | null;
  media: string;
  result: string;
  started_at: string;
}

export async function fetchRecentInteractions(): Promise<InteractionSummary[]> {
  const res = await apiFetch<{ data: BackendInteraction[] }>("/api/interactions?limit=50");
  return res.data.map((i) => ({
    id: i.id,
    customerName: i.customer_name ?? "—",
    agentId: i.agent_id !== null ? String(i.agent_id) : null,
    agentName: i.agent_name ?? "—",
    queueName: i.queue_name ?? "—",
    media: i.media,
    result: i.result,
    startedAt: i.started_at,
  }));
}
