import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { LegacyBtn } from "../shared/LegacyBtn";
import { LegacyDrawer } from "../shared/LegacyDrawer";
import { ConfirmDialogBox } from "../shared/ConfirmDialog";
import { LegacyHelpPanel } from "../shared/LegacyHelpPanel";
import {
  computeScore,
  deleteEvalForm,
  fetchEvalForms,
  fetchRawEvals,
  fetchRecentInteractions,
  fromBackendEval,
  submitEval,
  upsertEvalForm,
} from "./evaluationFormsService";
import type { Answer, EvalForm, EvalGroup, EvalQuestion, EvalRecord, InteractionSummary } from "./evalTypes";

const FORMS_KEY = ["eval-forms"];
const INTERACTIONS_KEY = ["eval-forms-interactions"];
const EVALS_KEY = ["eval-forms-recent-evals-raw"];

function uid(): string {
  return "q" + Math.random().toString(36).slice(2, 10);
}

function formMax(f: { groups: EvalGroup[] }): number {
  return f.groups.reduce((sum, g) => sum + g.questions.reduce((s, q) => s + q.weight, 0), 0);
}

function questionCount(f: { groups: EvalGroup[] }): number {
  return f.groups.reduce((sum, g) => sum + g.questions.length, 0);
}

type Draft = Omit<EvalForm, "id"> & { id?: string };

function emptyDraft(): Draft {
  return { name: "", published: false, groups: [{ name: "Group 1", questions: [] }] };
}

function goToAdminIndex(): void {
  const win = window as unknown as { adminIndex?: () => void; __hideEvalforms?: () => void };
  win.__hideEvalforms?.();
  win.adminIndex?.();
}

export function EvaluationFormsPage() {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<Draft | null>(null);
  // true = fresh "Perform Evaluation" from the header button; an EvalRecord =
  // reopened from a Recent evaluations row, pre-filled with what was answered.
  const [evaluating, setEvaluating] = useState<true | EvalRecord | false>(false);

  const { data: forms = [], isLoading: formsLoading } = useQuery({ queryKey: FORMS_KEY, queryFn: fetchEvalForms });
  const { data: interactions = [] } = useQuery({ queryKey: INTERACTIONS_KEY, queryFn: fetchRecentInteractions });
  const { data: rawEvals = [] } = useQuery({ queryKey: EVALS_KEY, queryFn: fetchRawEvals });
  // Joined against forms/interactions in a memo (not inside the query itself)
  // so it always reflects their latest data — the raw evals query has no way
  // to know when those two separate queries finish loading and refetch.
  const evals = useMemo(
    () => rawEvals.map((r) => fromBackendEval(r, forms, interactions)),
    [rawEvals, forms, interactions],
  );

  const saveMutation = useMutation({
    mutationFn: upsertEvalForm,
    onSuccess: (updated) => {
      queryClient.setQueryData(FORMS_KEY, updated);
      setEditing(null);
    },
  });
  const deleteMutation = useMutation({
    mutationFn: deleteEvalForm,
    onSuccess: (updated) => {
      queryClient.setQueryData(FORMS_KEY, updated);
      setEditing(null);
    },
  });

  const evalCountByForm = useMemo(() => {
    const counts = new Map<string, number>();
    for (const e of evals) {
      if (!e.formId) continue;
      counts.set(e.formId, (counts.get(e.formId) ?? 0) + 1);
    }
    return counts;
  }, [evals]);

  return (
    <>
      <div className="phd">
        <div className="bc">
          <a onClick={goToAdminIndex}>Admin</a> › Quality
        </div>
        <div className="tt">
          <h1>Evaluation Forms</h1>
          <div className="rt">
            <LegacyBtn onClick={() => setEditing(emptyDraft())}>+ Create Form</LegacyBtn>
            <LegacyBtn secondary onClick={() => setEvaluating(true)}>Perform Evaluation</LegacyBtn>
          </div>
        </div>
        <div className="tabs">
          <div className="tb on">Forms ({forms.length})</div>
        </div>
      </div>

      <div className="pbody">
        <div className="tblw" style={{ overflowX: "auto" }}>
          <table className="dt">
            <thead>
              <tr>
                <th>Form</th>
                <th>Groups</th>
                <th>Questions</th>
                <th>Max score</th>
                <th>Status</th>
                <th>Evaluations</th>
                <th style={{ width: 30 }}></th>
              </tr>
            </thead>
            <tbody>
              {formsLoading ? (
                <tr>
                  <td colSpan={7} style={{ color: "#8794a8", padding: 18 }}>Loading…</td>
                </tr>
              ) : forms.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ color: "#8794a8", padding: 18 }}>
                    No evaluation forms yet — use "+ Create Form" to add one.
                  </td>
                </tr>
              ) : (
                forms.map((f) => (
                  <tr key={f.id} onClick={() => setEditing(f)} style={{ cursor: "pointer" }}>
                    <td><b className="lnk">{f.name}</b></td>
                    <td>{f.groups.length}</td>
                    <td>{questionCount(f)}</td>
                    <td>{formMax(f)} pts</td>
                    <td>
                      {f.published ? (
                        <span className="st ok"><span className="d"></span>Published</span>
                      ) : (
                        <span className="st wn"><span className="d"></span>Draft</span>
                      )}
                    </td>
                    <td>{evalCountByForm.get(f.id) ?? 0}</td>
                    <td style={{ color: "#a9b3c2" }}>⋮</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <h1 style={{ fontSize: 15, margin: "18px 0 6px" }}>Recent evaluations ({evals.length})</h1>
        <div className="tblw" style={{ overflowX: "auto" }}>
          <table className="dt">
            <thead>
              <tr>
                <th>Agent</th>
                <th>Interaction</th>
                <th>Form</th>
                <th>Score</th>
                <th>When</th>
              </tr>
            </thead>
            <tbody>
              {evals.length === 0 ? (
                <tr>
                  <td colSpan={5} style={{ textAlign: "center", color: "#8794a8", padding: 18 }}>
                    No evaluations yet — click Perform Evaluation
                  </td>
                </tr>
              ) : (
                evals.map((e) => {
                  const color = e.pct >= 85 ? "#1f9d63" : e.pct >= 60 ? "#e0a200" : "#b3261e";
                  return (
                    <tr key={e.id} onClick={() => setEvaluating(e)} style={{ cursor: "pointer" }}>
                      <td><b>{e.agentName}</b></td>
                      <td>{e.interactionLabel}</td>
                      <td>{e.formName}</td>
                      <td>
                        <b style={{ color }}>{e.pct}%</b>
                        {e.criticalFail && <span className="tag o" style={{ marginLeft: 6 }}>critical fail</span>}
                      </td>
                      <td>{new Date(e.createdAt).toLocaleString()}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <LegacyHelpPanel topicKey="evalforms" />
      </div>

      {editing && (
        <FormEditorDrawer
          draft={editing}
          saving={saveMutation.isPending}
          deleting={deleteMutation.isPending}
          onClose={() => setEditing(null)}
          onSave={(value) => saveMutation.mutate(value)}
          {...(editing.id ? { onDelete: () => deleteMutation.mutate(editing.id as string) } : {})}
        />
      )}

      {evaluating && (
        <PerformEvaluationDrawer
          forms={forms.filter((f) => f.published || f.id === (evaluating !== true ? evaluating.formId : null))}
          interactions={interactions}
          {...(evaluating !== true ? { initial: evaluating } : {})}
          onClose={() => setEvaluating(false)}
          onSubmitted={() => {
            setEvaluating(false);
            queryClient.invalidateQueries({ queryKey: EVALS_KEY });
          }}
        />
      )}
    </>
  );
}

function FormEditorDrawer({
  draft,
  saving,
  deleting,
  onClose,
  onSave,
  onDelete,
}: {
  draft: Draft;
  saving: boolean;
  deleting: boolean;
  onClose: () => void;
  onSave: (value: Draft) => void;
  onDelete?: () => void;
}) {
  const [form, setForm] = useState(draft);
  const [errors, setErrors] = useState<string[]>([]);
  const [newGroupName, setNewGroupName] = useState("");
  const [newQuestion, setNewQuestion] = useState<Record<number, { text: string; weight: number; critical: boolean }>>({});
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  function questionDraft(gi: number) {
    return newQuestion[gi] ?? { text: "", weight: 10, critical: false };
  }

  function addGroup() {
    const name = newGroupName.trim();
    if (!name) return;
    setForm((f) => ({ ...f, groups: [...f.groups, { name, questions: [] }] }));
    setNewGroupName("");
  }

  function deleteGroup(gi: number) {
    setForm((f) => {
      if (f.groups.length <= 1) return f;
      return { ...f, groups: f.groups.filter((_, i) => i !== gi) };
    });
  }

  function addQuestion(gi: number) {
    const q = questionDraft(gi);
    const text = q.text.trim();
    if (!text) return;
    const newQ: EvalQuestion = { id: uid(), text, weight: q.weight || 10, critical: q.critical };
    setForm((f) => ({
      ...f,
      groups: f.groups.map((g, i) => (i === gi ? { ...g, questions: [...g.questions, newQ] } : g)),
    }));
    setNewQuestion((s) => ({ ...s, [gi]: { text: "", weight: 10, critical: false } }));
  }

  function deleteQuestion(gi: number, qi: number) {
    setForm((f) => ({
      ...f,
      groups: f.groups.map((g, i) => (i === gi ? { ...g, questions: g.questions.filter((_, j) => j !== qi) } : g)),
    }));
  }

  function validate(requirePublishable: boolean): string[] {
    const errs: string[] = [];
    if (form.name.trim().length < 2) errs.push("Form name is required.");
    if (requirePublishable && questionCount(form) === 0) errs.push("Add at least one question before publishing.");
    return errs;
  }

  function handleSave(publish?: boolean) {
    const errs = validate(!!publish || form.published);
    if (errs.length) {
      setErrors(errs);
      return;
    }
    onSave({ ...form, name: form.name.trim(), published: publish ? true : form.published });
  }

  if (confirmingDelete && onDelete) {
    return (
      <LegacyDrawer>
        <div id="scrim" onClick={() => setConfirmingDelete(false)} />
        <ConfirmDialogBox
          message={<>Delete evaluation form <b>{form.name}</b>?</>}
          onCancel={() => setConfirmingDelete(false)}
          onConfirm={() => {
            setConfirmingDelete(false);
            onClose();
            onDelete();
          }}
        />
      </LegacyDrawer>
    );
  }

  return (
    <LegacyDrawer>
      <div id="scrim" onClick={onClose} />
      <div id="drw" style={{ width: 580 }}>
        <div className="dh">
          <h2>
            {form.name || "New Evaluation Form"}{" "}
            <span className={"tag" + (form.published ? "" : " o")} style={{ marginLeft: 6 }}>
              {form.published ? "Published" : "Draft"}
            </span>
          </h2>
          <div className="x" onClick={onClose}>×</div>
        </div>
        <div className="db">
          {errors.length > 0 && (
            <div
              style={{
                background: "#fdecea",
                border: "1px solid #f5c6c0",
                color: "#b3261e",
                borderRadius: 5,
                padding: "8px 11px",
                fontSize: 12.5,
                marginBottom: 10,
              }}
            >
              {errors.map((e, i) => (
                <div key={i}>{e}</div>
              ))}
            </div>
          )}
          <div className="fld">
            <label>Form name *</label>
            <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
          </div>

          {form.groups.map((g, gi) => {
            const qd = questionDraft(gi);
            return (
              <div key={gi} style={{ marginBottom: 14 }}>
                <div className="sect" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  {g.name}
                  <a
                    className="lnk"
                    style={{ fontSize: 11, textTransform: "none", letterSpacing: 0 }}
                    onClick={() => deleteGroup(gi)}
                  >
                    delete group
                  </a>
                </div>
                {g.questions.length === 0 && (
                  <div style={{ color: "#8794a8", fontSize: 12, padding: "4px 0" }}>No questions</div>
                )}
                {g.questions.map((q, qi) => (
                  <div
                    key={q.id}
                    style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 0", borderBottom: "1px solid #f2f5f9", fontSize: 12.5 }}
                  >
                    <span style={{ flex: 1 }}>
                      {q.text}
                      {q.critical && <span className="tag o" style={{ marginLeft: 6 }}>critical</span>}
                    </span>
                    <span className="tag">{q.weight} pts</span>
                    <a className="lnk" style={{ fontSize: 11 }} onClick={() => deleteQuestion(gi, qi)}>remove</a>
                  </div>
                ))}
                <div style={{ display: "flex", gap: 6, marginTop: 6, alignItems: "center" }}>
                  <input
                    placeholder="New question text"
                    value={qd.text}
                    onChange={(e) => setNewQuestion((s) => ({ ...s, [gi]: { ...qd, text: e.target.value } }))}
                    style={{ flex: 1, height: 30, border: "1px solid #ccd4e0", borderRadius: 4, padding: "0 8px", fontSize: 12 }}
                  />
                  <input
                    type="number"
                    value={qd.weight}
                    title="weight"
                    onChange={(e) => {
                      const raw = e.target.value;
                      setNewQuestion((s) => ({ ...s, [gi]: { ...qd, weight: (raw === "" ? "" : parseInt(raw, 10) || 0) as unknown as number } } ));
                    }}
                    style={{ width: 56, height: 30, border: "1px solid #ccd4e0", borderRadius: 4, padding: "0 6px", fontSize: 12 }}
                  />
                  <label style={{ fontSize: 11, display: "flex", alignItems: "center", gap: 3 }}>
                    <input
                      type="checkbox"
                      checked={qd.critical}
                      onChange={(e) => setNewQuestion((s) => ({ ...s, [gi]: { ...qd, critical: e.target.checked } }))}
                      style={{ width: "auto" }}
                    />
                    crit
                  </label>
                  <LegacyBtn secondary onClick={() => addQuestion(gi)} style={{ height: 30 }}>+ Add</LegacyBtn>
                </div>
              </div>
            );
          })}

          <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
            <input
              placeholder="New group name"
              value={newGroupName}
              onChange={(e) => setNewGroupName(e.target.value)}
              style={{ flex: 1, height: 30, border: "1px solid #ccd4e0", borderRadius: 4, padding: "0 8px", fontSize: 12 }}
            />
            <LegacyBtn secondary onClick={addGroup} style={{ height: 30 }}>+ Add group</LegacyBtn>
          </div>

          <div style={{ marginTop: 12, fontSize: 12, color: "#5b6b82" }}>
            Max score: <b>{formMax(form)} pts</b> — a failed <b>critical</b> question caps the evaluation at 0 for its group and flags the evaluation.
          </div>

          <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
            {!form.published && (
              <LegacyBtn onClick={() => handleSave(true)} disabled={saving}>Publish form</LegacyBtn>
            )}
            {onDelete && (
              <LegacyBtn ghost disabled={deleting} onClick={() => setConfirmingDelete(true)}>
                {deleting ? "Deleting…" : "Delete form"}
              </LegacyBtn>
            )}
          </div>
        </div>
        <div className="df">
          <LegacyBtn secondary onClick={onClose} disabled={saving}>Close</LegacyBtn>
          <LegacyBtn onClick={() => handleSave()} disabled={saving}>
            {saving ? "Saving…" : "Save & close"}
          </LegacyBtn>
        </div>
      </div>
    </LegacyDrawer>
  );
}

function PerformEvaluationDrawer({
  forms,
  interactions,
  initial,
  onClose,
  onSubmitted,
}: {
  forms: EvalForm[];
  interactions: InteractionSummary[];
  initial?: EvalRecord;
  onClose: () => void;
  onSubmitted: () => void;
}) {
  const [interactionId, setInteractionId] = useState(initial?.interactionId ?? "");
  const [formId, setFormId] = useState(initial?.formId ?? "");
  const [answers, setAnswers] = useState<Record<string, Answer>>(initial?.answers ?? {});
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const form = forms.find((f) => f.id === formId) ?? null;
  const preview = form ? computeScore(form, answers) : null;

  async function handleSubmit() {
    if (!interactionId) { setError("Pick an interaction to evaluate."); return; }
    if (!form) { setError("Pick a published form to evaluate against."); return; }
    setSubmitting(true);
    setError("");
    try {
      const score = computeScore(form, answers);
      await submitEval({ formId: form.id, interactionId, answers, pct: score.pct, criticalFail: score.criticalFail });
      onSubmitted();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Submit failed — please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <LegacyDrawer>
      <div id="scrim" onClick={onClose} />
      <div id="drw" style={{ width: 580 }}>
        <div className="dh">
          <h2>Perform Evaluation</h2>
          <div className="x" onClick={onClose}>×</div>
        </div>
        <div className="db">
          {error && (
            <div style={{ background: "#fdecea", border: "1px solid #f5c6c0", color: "#b3261e", borderRadius: 5, padding: "8px 11px", fontSize: 12.5, marginBottom: 10 }}>
              {error}
            </div>
          )}
          <div className="fld">
            <label>Interaction</label>
            <select value={interactionId} onChange={(e) => setInteractionId(e.target.value)}>
              <option value="">— Select an interaction —</option>
              {interactions.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.customerName} · {i.agentName} · {i.queueName} · {new Date(i.startedAt).toLocaleDateString()}
                </option>
              ))}
            </select>
            {interactions.length === 0 && (
              <div style={{ fontSize: 12, color: "#8794a8", marginTop: 4 }}>No interactions available yet.</div>
            )}
          </div>
          <div className="fld">
            <label>Evaluation form (published only)</label>
            <select value={formId} onChange={(e) => { setFormId(e.target.value); setAnswers({}); }}>
              <option value="">— Select a form —</option>
              {forms.map((f) => (
                <option key={f.id} value={f.id}>{f.name}</option>
              ))}
            </select>
            {forms.length === 0 && (
              <div style={{ fontSize: 12, color: "#8794a8", marginTop: 4 }}>No published forms yet — publish one first.</div>
            )}
          </div>

          {form && (
            <>
              {form.groups.map((g, gi) => (
                <div key={gi} style={{ marginBottom: 12 }}>
                  <div className="sect">{g.name}</div>
                  {g.questions.map((q) => (
                    <div key={q.id} style={{ padding: "6px 0", borderBottom: "1px solid #f2f5f9" }}>
                      <div style={{ fontSize: 12.5, marginBottom: 4 }}>
                        {q.text}
                        {q.critical && <span className="tag o" style={{ marginLeft: 6 }}>critical</span>}
                        <span className="tag" style={{ marginLeft: 6 }}>{q.weight} pts</span>
                      </div>
                      <div style={{ display: "flex", gap: 14 }}>
                        {(["yes", "no", "na"] as Answer[]).map((opt) => (
                          <label key={opt} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12 }}>
                            <input
                              type="radio"
                              name={`q_${q.id}`}
                              checked={answers[q.id] === opt}
                              onChange={() => setAnswers((a) => ({ ...a, [q.id]: opt }))}
                              style={{ width: "auto" }}
                            />
                            {opt === "yes" ? "Yes" : opt === "no" ? "No" : "N/A"}
                          </label>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              ))}
              {preview && (
                <div style={{ marginTop: 10, fontSize: 13 }}>
                  Score: <b style={{ color: preview.pct >= 85 ? "#1f9d63" : preview.pct >= 60 ? "#e0a200" : "#b3261e" }}>
                    {preview.pct}% ({preview.earned}/{preview.possible} pts)
                  </b>
                  {preview.criticalFail && <span className="tag o" style={{ marginLeft: 6 }}>critical fail</span>}
                </div>
              )}
            </>
          )}
        </div>
        <div className="df">
          <LegacyBtn secondary onClick={onClose} disabled={submitting}>Cancel</LegacyBtn>
          <LegacyBtn onClick={handleSubmit} disabled={submitting || !form || !interactionId}>
            {submitting ? "Saving…" : "Score & save"}
          </LegacyBtn>
        </div>
      </div>
    </LegacyDrawer>
  );
}
