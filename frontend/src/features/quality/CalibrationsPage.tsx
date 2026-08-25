import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { LegacyBtn } from "../shared/LegacyBtn";
import { LegacyDrawer } from "../shared/LegacyDrawer";
import { ConfirmDialogBox } from "../shared/ConfirmDialog";
import { LegacyHelpPanel } from "../shared/LegacyHelpPanel";
import type { Calibration, CalibStatus, PersonOption } from "./calibTypes";
import {
  CALIB_DIVISIONS,
  computeVariance,
  computedStatus,
  deleteCalibration,
  fetchCalibrations,
  fetchFormNamesForCalibration,
  fetchGroupsForCalibration,
  fetchInteractionsForCalibration,
  fetchPeopleForCalibration,
  upsertCalibration,
  type GroupOption,
  type InteractionOption,
} from "./calibrationsService";

const CALIB_KEY = ["calibrations"];
const PEOPLE_KEY = ["calibrations-people"];
const FORMS_KEY = ["calibrations-forms"];
const INTERACTIONS_KEY = ["calibrations-interactions"];
const GROUPS_KEY = ["calibrations-groups"];

type Draft = Omit<Calibration, "id"> & { id?: string };

type Tab = "calibrations" | "results" | "consistency";

type ColKey = "interaction" | "form" | "evaluators" | "completed" | "variance" | "status";

const ALL_COLS: { key: ColKey; label: string }[] = [
  { key: "interaction", label: "Interaction" },
  { key: "form", label: "Form" },
  { key: "evaluators", label: "Evaluators" },
  { key: "completed", label: "Completed" },
  { key: "variance", label: "Variance" },
  { key: "status", label: "Status" },
];

function emptyDraft(): Draft {
  return {
    name: "", formRef: "", interactionRef: "", division: "", status: "Scheduled", evaluators: [], notes: "",
    dueDate: "", hideScoresUntilComplete: true, includeAgentSelfAssessment: false, notifyEvaluatorsByEmail: true,
  };
}

function goToAdminIndex(): void {
  const win = window as unknown as { adminIndex?: () => void; __hideCalibrations?: () => void };
  win.__hideCalibrations?.();
  win.adminIndex?.();
}

function interactionLabel(id: string, interactions: InteractionOption[]): string {
  return interactions.find((i) => i.id === id)?.label ?? id ?? "—";
}

function divisionLabel(code: string): string {
  return CALIB_DIVISIONS.find((d) => d.code === code)?.label ?? "—";
}

function statusClass(status: CalibStatus): string {
  if (status === "Completed") return "st ok";
  if (status === "In Progress") return "st wn";
  if (status === "Review Variance") return "st er";
  return "st of";
}

function StatusBadge({ status }: { status: CalibStatus }) {
  return (
    <span className={statusClass(status)}>
      <span className="d"></span>
      {status}
    </span>
  );
}

function escapeCsvCell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function exportCalibrationsCsv(rows: Calibration[], interactions: InteractionOption[]): void {
  const lines = ["Calibration,Interaction,Form,Division,Evaluators,Completed,Variance,Status"].concat(
    rows.map((c) => {
      const completed = c.evaluators.filter((e) => e.score !== null).length;
      const variance = computeVariance(c.evaluators);
      const status = computedStatus(c.evaluators);
      return [
        c.name,
        interactionLabel(c.interactionRef, interactions),
        c.formRef || "—",
        divisionLabel(c.division),
        String(c.evaluators.length),
        `${completed} of ${c.evaluators.length}`,
        variance === null ? "—" : `${variance} pts`,
        status,
      ]
        .map(escapeCsvCell)
        .join(",");
    }),
  );
  const blob = new Blob([lines.join("\n")], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "calibrations.csv";
  a.click();
  URL.revokeObjectURL(a.href);
}

export function CalibrationsPage() {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<Draft | null>(null);
  const [tab, setTab] = useState<Tab>("calibrations");
  const [selected, setSelected] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [divFilter, setDivFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [visibleCols, setVisibleCols] = useState<Record<ColKey, boolean>>({
    interaction: true,
    form: true,
    evaluators: true,
    completed: true,
    variance: true,
    status: true,
  });

  const { data: calibrations = [], isLoading } = useQuery({ queryKey: CALIB_KEY, queryFn: fetchCalibrations });
  const { data: people = [] } = useQuery({ queryKey: PEOPLE_KEY, queryFn: fetchPeopleForCalibration });
  const { data: formNames = [] } = useQuery({ queryKey: FORMS_KEY, queryFn: fetchFormNamesForCalibration });
  const { data: interactions = [] } = useQuery({ queryKey: INTERACTIONS_KEY, queryFn: fetchInteractionsForCalibration });
  const { data: groups = [] } = useQuery({ queryKey: GROUPS_KEY, queryFn: fetchGroupsForCalibration });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return calibrations.filter((c) => {
      if (q && !c.name.toLowerCase().includes(q)) return false;
      if (divFilter && c.division !== divFilter) return false;
      if (statusFilter && computedStatus(c.evaluators) !== statusFilter) return false;
      return true;
    });
  }, [calibrations, search, divFilter, statusFilter]);

  // Results — calibrations with at least 2 scored evaluators, so a spread
  // between their scores actually means something.
  const results = useMemo(
    () => calibrations.filter((c) => c.evaluators.filter((e) => e.score !== null).length >= 2),
    [calibrations],
  );

  // Evaluator Consistency — every evaluator's average score across all
  // calibrations they scored, compared against the average of every score
  // anyone gave (the "team average").
  const consistency = useMemo(() => {
    const allScores: number[] = [];
    const byEvaluator = new Map<string, number[]>();
    for (const c of calibrations) {
      for (const ev of c.evaluators) {
        if (ev.score === null) continue;
        allScores.push(ev.score);
        const existing = byEvaluator.get(ev.name) ?? [];
        existing.push(ev.score);
        byEvaluator.set(ev.name, existing);
      }
    }
    const teamAvg = allScores.length ? allScores.reduce((a, b) => a + b, 0) / allScores.length : 0;
    return Array.from(byEvaluator.entries())
      .map(([name, scores]) => {
        const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
        return { name, avg, vsTeam: avg - teamAvg };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [calibrations]);

  const saveMutation = useMutation({
    mutationFn: upsertCalibration,
    onSuccess: (updated) => {
      queryClient.setQueryData(CALIB_KEY, updated);
      setEditing(null);
    },
  });
  const deleteMutation = useMutation({
    mutationFn: deleteCalibration,
    onSuccess: (updated) => {
      queryClient.setQueryData(CALIB_KEY, updated);
      setEditing(null);
    },
  });
  const bulkDeleteMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      let updated: Calibration[] = calibrations;
      for (const id of ids) updated = await deleteCalibration(id);
      return updated;
    },
    onSuccess: (updated) => {
      queryClient.setQueryData(CALIB_KEY, updated);
      setSelected([]);
    },
  });

  const visibleColCount = 3 + ALL_COLS.filter((c) => visibleCols[c.key]).length; // checkbox + name + action col

  return (
    <>
      <div className="phd">
        <div className="bc">
          <a onClick={goToAdminIndex}>Admin</a> › Quality
        </div>
        <div className="tt">
          <h1>Calibrations</h1>
          <div className="rt">
            <LegacyBtn secondary onClick={() => exportCalibrationsCsv(filtered, interactions)}>
              ⭳ Export
            </LegacyBtn>
            <LegacyBtn onClick={() => setEditing(emptyDraft())}>+ New Calibration</LegacyBtn>
          </div>
        </div>
        <div className="tabs">
          <div className={"tb" + (tab === "calibrations" ? " on" : "")} onClick={() => setTab("calibrations")}>
            Calibrations ({calibrations.length})
          </div>
          <div className={"tb" + (tab === "results" ? " on" : "")} onClick={() => setTab("results")}>
            Results
          </div>
          <div className={"tb" + (tab === "consistency" ? " on" : "")} onClick={() => setTab("consistency")}>
            Evaluator Consistency
          </div>
        </div>
      </div>

      <div className="pbody">
        {tab === "calibrations" && (
          <>
            {selected.length > 0 && (
              <div style={{ display: "flex", alignItems: "center", gap: 8, background: "#fff7f4", border: "1px solid #ffd9cc", borderRadius: 6, padding: "7px 12px", margin: "0 0 10px" }}>
                <b style={{ fontSize: 12.5 }}>{selected.length} selected</b>
                <LegacyBtn
                  style={{ height: 28 }}
                  disabled={bulkDeleteMutation.isPending}
                  onClick={() => bulkDeleteMutation.mutate(selected)}
                >
                  {bulkDeleteMutation.isPending ? "Deleting…" : "Delete"}
                </LegacyBtn>
              </div>
            )}
            <div className="tbar">
              <input
                className="s"
                placeholder="Search calibrations"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <select className="chip" style={{ cursor: "pointer" }} value={divFilter} onChange={(e) => setDivFilter(e.target.value)}>
                <option value="">Division: All</option>
                {CALIB_DIVISIONS.map((d) => (
                  <option key={d.code} value={d.code}>{d.label}</option>
                ))}
              </select>
              <select className="chip" style={{ cursor: "pointer" }} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                <option value="">Status: Any</option>
                <option value="Scheduled">Scheduled</option>
                <option value="In Progress">In progress</option>
                <option value="Review Variance">Review variance</option>
                <option value="Completed">Complete</option>
              </select>
              <div className="sp" />
              <div style={{ position: "relative" }}>
                <div className="chip" style={{ cursor: "pointer" }} onClick={() => setColumnsOpen((v) => !v)}>
                  ☰ Columns
                </div>
                {columnsOpen && (
                  <>
                    <div style={{ position: "fixed", inset: 0, zIndex: 149 }} onClick={() => setColumnsOpen(false)} />
                    <div
                      style={{
                        position: "absolute", right: 0, top: 36, zIndex: 150, background: "#fff",
                        border: "1px solid #dde3ec", borderRadius: 6, boxShadow: "0 6px 20px rgba(16,30,60,.14)",
                        padding: 10, width: 190,
                      }}
                    >
                      {ALL_COLS.map((c) => (
                        <label key={c.key} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, padding: "4px 2px", cursor: "pointer" }}>
                          <input
                            type="checkbox"
                            checked={visibleCols[c.key]}
                            onChange={(e) => setVisibleCols((v) => ({ ...v, [c.key]: e.target.checked }))}
                          />
                          {c.label}
                        </label>
                      ))}
                      <div style={{ marginTop: 8, textAlign: "right" }}>
                        <LegacyBtn secondary style={{ height: 26, fontSize: 11.5 }} onClick={() => setColumnsOpen(false)}>Done</LegacyBtn>
                      </div>
                    </div>
                  </>
                )}
              </div>
              <div className="chip" style={{ cursor: "pointer" }} onClick={() => queryClient.invalidateQueries({ queryKey: CALIB_KEY })}>
                ↻ Refresh
              </div>
            </div>

            <div className="tblw" style={{ overflowX: "auto" }}>
              <table className="dt">
                <thead>
                  <tr>
                    <th style={{ width: 34 }}>
                      <input
                        type="checkbox"
                        checked={filtered.length > 0 && selected.length === filtered.length}
                        onChange={(e) => setSelected(e.target.checked ? filtered.map((c) => c.id) : [])}
                      />
                    </th>
                    <th>Calibration</th>
                    {visibleCols.interaction && <th>Interaction</th>}
                    {visibleCols.form && <th>Form</th>}
                    {visibleCols.evaluators && <th>Evaluators</th>}
                    {visibleCols.completed && <th>Completed</th>}
                    {visibleCols.variance && <th>Variance</th>}
                    {visibleCols.status && <th>Status</th>}
                    <th style={{ width: 30 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {isLoading ? (
                    <tr>
                      <td colSpan={visibleColCount} style={{ color: "#8794a8", padding: 18 }}>Loading…</td>
                    </tr>
                  ) : filtered.length === 0 ? (
                    <tr>
                      <td colSpan={visibleColCount} style={{ color: "#8794a8", padding: 18 }}>
                        {calibrations.length === 0
                          ? 'No calibrations yet — use "+ New Calibration" to add one.'
                          : "No calibrations match the current filters."}
                      </td>
                    </tr>
                  ) : (
                    filtered.map((c) => {
                      const completed = c.evaluators.filter((e) => e.score !== null).length;
                      const variance = computeVariance(c.evaluators);
                      const status = computedStatus(c.evaluators);
                      return (
                        <tr key={c.id} onClick={() => setEditing(c)} style={{ cursor: "pointer" }}>
                          <td onClick={(e) => e.stopPropagation()}>
                            <input
                              type="checkbox"
                              checked={selected.includes(c.id)}
                              onChange={(e) =>
                                setSelected((s) => (e.target.checked ? [...s, c.id] : s.filter((id) => id !== c.id)))
                              }
                            />
                          </td>
                          <td><b className="lnk">{c.name}</b></td>
                          {visibleCols.interaction && <td>{interactionLabel(c.interactionRef, interactions)}</td>}
                          {visibleCols.form && <td>{c.formRef || "—"}</td>}
                          {visibleCols.evaluators && <td>{c.evaluators.length}</td>}
                          {visibleCols.completed && <td>{completed} of {c.evaluators.length}</td>}
                          {visibleCols.variance && <td>{variance === null ? "—" : `${variance} pts`}</td>}
                          {visibleCols.status && <td><StatusBadge status={status} /></td>}
                          <td style={{ color: "#a9b3c2" }}>⋮</td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}

        {tab === "results" && (
          <div className="tblw" style={{ overflowX: "auto" }}>
            <table className="dt">
              <thead>
                <tr>
                  <th>Calibration</th>
                  <th>Interaction</th>
                  <th>Evaluators</th>
                  <th>Spread</th>
                </tr>
              </thead>
              <tbody>
                {results.length === 0 ? (
                  <tr>
                    <td colSpan={4} style={{ color: "#8794a8", padding: 18 }}>
                      No results yet — results appear once at least 2 evaluators have scored a calibration.
                    </td>
                  </tr>
                ) : (
                  results.map((c) => {
                    const scores = c.evaluators.map((e) => e.score).filter((s): s is number => s !== null);
                    const variance = computeVariance(c.evaluators);
                    return (
                      <tr key={c.id} onClick={() => setEditing(c)} style={{ cursor: "pointer" }}>
                        <td><b className="lnk">{c.name}</b></td>
                        <td>{interactionLabel(c.interactionRef, interactions)}</td>
                        <td>{c.evaluators.length}</td>
                        <td>{scores.map((s) => `${s}%`).join(" / ")} — within {variance} pts</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        )}

        {tab === "consistency" && (
          <div className="tblw" style={{ overflowX: "auto" }}>
            <table className="dt">
              <thead>
                <tr>
                  <th>Evaluator</th>
                  <th>Avg score given</th>
                  <th>vs team avg</th>
                </tr>
              </thead>
              <tbody>
                {consistency.length === 0 ? (
                  <tr>
                    <td colSpan={3} style={{ color: "#8794a8", padding: 18 }}>
                      No scored evaluations yet.
                    </td>
                  </tr>
                ) : (
                  consistency.map((row) => (
                    <tr key={row.name}>
                      <td><b>{row.name}</b></td>
                      <td>{Math.round(row.avg)}%</td>
                      <td style={{ color: row.vsTeam >= 0 ? "#1f9d63" : "#b3261e" }}>
                        {row.vsTeam >= 0 ? "+" : ""}{row.vsTeam.toFixed(1)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}

        <LegacyHelpPanel topicKey="calib" />
      </div>

      {editing && (
        <CalibrationDrawer
          draft={editing}
          people={people}
          groups={groups}
          formNames={formNames}
          interactions={interactions}
          saving={saveMutation.isPending}
          deleting={deleteMutation.isPending}
          onClose={() => setEditing(null)}
          onSave={(value) => saveMutation.mutate(value)}
          {...(editing.id ? { onDelete: () => deleteMutation.mutate(editing.id as string) } : {})}
        />
      )}
    </>
  );
}

function CalibrationDrawer({
  draft,
  people,
  groups,
  formNames,
  interactions,
  saving,
  deleting,
  onClose,
  onSave,
  onDelete,
}: {
  draft: Draft;
  people: PersonOption[];
  groups: GroupOption[];
  formNames: string[];
  interactions: InteractionOption[];
  saving: boolean;
  deleting: boolean;
  onClose: () => void;
  onSave: (value: Draft) => void;
  onDelete?: () => void;
}) {
  const [form, setForm] = useState(draft);
  const [errors, setErrors] = useState<string[]>([]);
  const [addGroupId, setAddGroupId] = useState("");
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const isNew = !form.id;

  // Bulk-adds every real member of the chosen group (see people_groups /
  // GroupsPage.tsx) as an evaluator, skipping anyone already in the list —
  // selecting a group in the dropdown adds it immediately, no separate button.
  function addGroup(groupId: string) {
    setAddGroupId(groupId);
    const group = groups.find((g) => g.id === groupId);
    if (!group) return;
    const namesToAdd = group.memberIds
      .map((id) => people.find((p) => p.id === id)?.name)
      .filter((name): name is string => !!name && !form.evaluators.some((e) => e.name === name));
    if (namesToAdd.length) {
      setForm((f) => ({ ...f, evaluators: [...f.evaluators, ...namesToAdd.map((name) => ({ name, score: null }))] }));
    }
  }

  function removeEvaluator(name: string) {
    setForm((f) => ({ ...f, evaluators: f.evaluators.filter((e) => e.name !== name) }));
  }

  // Turning this on adds the selected interaction's own agent to the
  // evaluators list (a real self-assessment score, not just a stored flag) —
  // turning it off leaves any scores already entered untouched.
  function toggleSelfAssessment(checked: boolean) {
    setForm((f) => {
      if (!checked) return { ...f, includeAgentSelfAssessment: false };
      const agentName = interactions.find((i) => i.id === f.interactionRef)?.agentName;
      if (!agentName || f.evaluators.some((e) => e.name === agentName)) {
        return { ...f, includeAgentSelfAssessment: true };
      }
      return { ...f, includeAgentSelfAssessment: true, evaluators: [...f.evaluators, { name: agentName, score: null }] };
    });
  }

  function setScore(name: string, value: string) {
    const score = value === "" ? null : Math.max(0, Math.min(100, parseInt(value, 10) || 0));
    setForm((f) => ({
      ...f,
      evaluators: f.evaluators.map((e) => (e.name === name ? { ...e, score } : e)),
    }));
  }

  function handleSave() {
    const errs: string[] = [];
    if (form.name.trim().length < 2) errs.push("Calibration name is required.");
    if (errs.length) {
      setErrors(errs);
      return;
    }
    onSave({ ...form, name: form.name.trim(), status: computedStatus(form.evaluators) });
  }

  const variance = computeVariance(form.evaluators);

  if (confirmingDelete && onDelete) {
    return (
      <LegacyDrawer>
        <div id="scrim" onClick={() => setConfirmingDelete(false)} />
        <ConfirmDialogBox
          message={<>Delete calibration <b>{form.name}</b>?</>}
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
      <div id="drw" style={{ width: 520 }}>
        <div className="dh">
          <h2>{isNew ? "New Calibration" : `Edit — ${form.name}`}</h2>
          <div className="x" onClick={onClose}>×</div>
        </div>
        <div className="db">
          {errors.length > 0 && (
            <div style={{ background: "#fdecea", border: "1px solid #f5c6c0", color: "#b3261e", borderRadius: 5, padding: "8px 11px", fontSize: 12.5, marginBottom: 10 }}>
              {errors.map((e, i) => (
                <div key={i}>{e}</div>
              ))}
            </div>
          )}
          <div className="fld">
            <label>Name *</label>
            <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
          </div>
          <div className="fld">
            <label>Interaction ID</label>
            <input
              value={form.interactionRef}
              onChange={(e) => setForm((f) => ({ ...f, interactionRef: e.target.value }))}
              placeholder="e.g. CONV-8841204"
              list="calib-interaction-ids"
            />
            <datalist id="calib-interaction-ids">
              {interactions.map((i) => (
                <option key={i.id} value={i.id}>{i.label}</option>
              ))}
            </datalist>
          </div>
          <div className="fld">
            <label>Evaluation form</label>
            <select value={form.formRef} onChange={(e) => setForm((f) => ({ ...f, formRef: e.target.value }))}>
              <option value="">— none —</option>
              {formNames.map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </div>

          <div className="sect">Evaluators ({form.evaluators.length})</div>
          <div className="fld">
            <label>Add group</label>
            <select value={addGroupId} onChange={(e) => addGroup(e.target.value)}>
              <option value="">— none —</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>{g.name}</option>
              ))}
            </select>
          </div>
          <div className="fld">
            <label>Due date</label>
            <input type="date" value={form.dueDate} onChange={(e) => setForm((f) => ({ ...f, dueDate: e.target.value }))} />
          </div>
          {form.evaluators.length === 0 && (
            <div style={{ color: "#8794a8", fontSize: 12, padding: "4px 0" }}>No evaluators added yet.</div>
          )}
          {form.evaluators.map((ev) => (
            <div key={ev.name} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 0", borderBottom: "1px solid #f2f5f9", fontSize: 12.5 }}>
              <span style={{ flex: 1 }}>{ev.name}</span>
              <input
                type="number"
                min={0}
                max={100}
                placeholder="score %"
                value={ev.score ?? ""}
                onChange={(e) => setScore(ev.name, e.target.value)}
                style={{ width: 70, height: 30, border: "1px solid #ccd4e0", borderRadius: 4, padding: "0 6px", fontSize: 12 }}
              />
              <a className="lnk" style={{ fontSize: 11 }} onClick={() => removeEvaluator(ev.name)}>remove</a>
            </div>
          ))}

          {variance !== null && (
            <div style={{ marginTop: 10, fontSize: 12.5, color: "#5b6b82" }}>
              Variance across scored evaluators: <b>{variance} pts</b>
            </div>
          )}

          <div className="sect">Options</div>
          <div className="tgl" style={{ cursor: "pointer" }} onClick={() => setForm((f) => ({ ...f, hideScoresUntilComplete: !f.hideScoresUntilComplete }))}>
            <div className={"sw" + (form.hideScoresUntilComplete ? " on" : "")}></div>
            Hide other evaluators&rsquo; scores until complete
          </div>
          <div className="tgl" style={{ cursor: "pointer" }} onClick={() => toggleSelfAssessment(!form.includeAgentSelfAssessment)}>
            <div className={"sw" + (form.includeAgentSelfAssessment ? " on" : "")}></div>
            Include agent self-assessment
          </div>
          <div className="tgl" style={{ cursor: "pointer" }} onClick={() => setForm((f) => ({ ...f, notifyEvaluatorsByEmail: !f.notifyEvaluatorsByEmail }))}>
            <div className={"sw" + (form.notifyEvaluatorsByEmail ? " on" : "")}></div>
            Notify evaluators by email
          </div>

          {onDelete && (
            <div style={{ marginTop: 10 }}>
              <LegacyBtn ghost disabled={deleting} onClick={() => setConfirmingDelete(true)}>
                {deleting ? "Deleting…" : "Delete calibration"}
              </LegacyBtn>
            </div>
          )}
        </div>
        <div className="df">
          <LegacyBtn secondary onClick={onClose} disabled={saving}>Cancel</LegacyBtn>
          <LegacyBtn onClick={handleSave} disabled={saving}>{saving ? "Saving…" : "Save"}</LegacyBtn>
        </div>
      </div>
    </LegacyDrawer>
  );
}
