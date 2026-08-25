import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { LegacyBtn } from "../shared/LegacyBtn";
import { LegacyDrawer } from "../shared/LegacyDrawer";
import { ConfirmDialogBox } from "../shared/ConfirmDialog";
import { LegacyHelpPanel } from "../shared/LegacyHelpPanel";
import type { Forecast, PlanningGroup, QueueOption, ServiceGoal } from "./forecastTypes";
import {
  DAYS,
  currentWeekLabel,
  deleteForecast,
  deletePlanningGroup,
  deleteServiceGoal,
  fetchForecasts,
  fetchLangNames,
  fetchPlanningGroups,
  fetchQueuesForForecast,
  fetchServiceGoals,
  fetchSkillNames,
  generateForecast,
  saveForecast,
  upsertPlanningGroup,
  upsertServiceGoal,
} from "./forecastsService";

const PG_KEY = ["forecasts-planning-groups"];
const SG_KEY = ["forecasts-service-goals"];
const FC_KEY = ["forecasts-forecasts"];
const QUEUES_KEY = ["forecasts-queues"];
const SKILLS_KEY = ["forecasts-skills"];
const LANGS_KEY = ["forecasts-langs"];

type Tab = "Forecasts" | "Planning Groups" | "Service Goals";

function goToAdminIndex(): void {
  const win = window as unknown as { adminIndex?: () => void; __hideForecasts?: () => void };
  win.__hideForecasts?.();
  win.adminIndex?.();
}

export function ForecastsPage() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>("Forecasts");
  const [editingPG, setEditingPG] = useState<(Omit<PlanningGroup, "id"> & { id?: string }) | null>(null);
  const [editingSG, setEditingSG] = useState<(Omit<ServiceGoal, "id"> & { id?: string }) | null>(null);
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState("");

  const { data: planningGroups = [] } = useQuery({ queryKey: PG_KEY, queryFn: fetchPlanningGroups });
  const { data: serviceGoals = [] } = useQuery({ queryKey: SG_KEY, queryFn: fetchServiceGoals });
  const { data: forecasts = [] } = useQuery({ queryKey: FC_KEY, queryFn: fetchForecasts });
  const { data: queues = [] } = useQuery({ queryKey: QUEUES_KEY, queryFn: fetchQueuesForForecast });
  const { data: skills = [] } = useQuery({ queryKey: SKILLS_KEY, queryFn: fetchSkillNames });
  const { data: langs = [] } = useQuery({ queryKey: LANGS_KEY, queryFn: fetchLangNames });

  const savePGMutation = useMutation({
    mutationFn: upsertPlanningGroup,
    onSuccess: (updated) => { queryClient.setQueryData(PG_KEY, updated); setEditingPG(null); },
  });
  const deletePGMutation = useMutation({
    mutationFn: deletePlanningGroup,
    onSuccess: (updated) => { queryClient.setQueryData(PG_KEY, updated); setEditingPG(null); },
  });
  const saveSGMutation = useMutation({
    mutationFn: upsertServiceGoal,
    onSuccess: (updated) => { queryClient.setQueryData(SG_KEY, updated); setEditingSG(null); },
  });
  const deleteSGMutation = useMutation({
    mutationFn: deleteServiceGoal,
    onSuccess: (updated) => { queryClient.setQueryData(SG_KEY, updated); setEditingSG(null); },
  });
  const deleteForecastMutation = useMutation({
    mutationFn: deleteForecast,
    onSuccess: (updated) => queryClient.setQueryData(FC_KEY, updated),
  });

  async function handleGenerate() {
    const week = currentWeekLabel();
    if (forecasts.some((f) => f.week === week)) {
      setGenError(`A forecast for ${week} already exists — delete it to regenerate.`);
      return;
    }
    setGenerating(true);
    setGenError("");
    try {
      const payload = await generateForecast(planningGroups, queues);
      const updated = await saveForecast(payload);
      queryClient.setQueryData(FC_KEY, updated);
    } catch (e) {
      setGenError(e instanceof Error ? e.message : "Generate failed — please try again.");
    } finally {
      setGenerating(false);
    }
  }

  const queueById = new Map(queues.map((q) => [q.id, q.name]));
  const pgById = new Map(planningGroups.map((p) => [p.id, p]));

  return (
    <>
      <div className="phd">
        <div className="bc">
          <a onClick={goToAdminIndex}>Admin</a> › Quality &amp; WEM
        </div>
        <div className="tt">
          <h1>Forecasts</h1>
          {tab === "Forecasts" && (
            <div className="rt">
              <LegacyBtn onClick={handleGenerate} disabled={generating}>
                {generating ? "Generating…" : `⚡ Generate Forecast (${currentWeekLabel()})`}
              </LegacyBtn>
            </div>
          )}
          {tab === "Planning Groups" && (
            <div className="rt">
              <LegacyBtn onClick={() => setEditingPG({ name: "", queues: [], skills: [], langs: ["English"] })}>+ Planning Group</LegacyBtn>
            </div>
          )}
          {tab === "Service Goals" && (
            <div className="rt">
              <LegacyBtn onClick={() => setEditingSG({ name: "", sl: 80, sls: 20, asa: 30, abn: 5, pgs: [] })}>+ Service Goal</LegacyBtn>
            </div>
          )}
        </div>
        <div className="tabs">
          {(["Forecasts", "Planning Groups", "Service Goals"] as Tab[]).map((t) => (
            <div key={t} className={"tb" + (tab === t ? " on" : "")} style={{ cursor: "pointer" }} onClick={() => setTab(t)}>
              {t}
            </div>
          ))}
        </div>
      </div>

      <div className="pbody">
        {tab === "Planning Groups" && (
          <>
            <div style={{ fontSize: 12, color: "#5b6b82", marginBottom: 10 }}>
              A planning group maps <b>route paths</b> — queue + ACD skill + language — to one forecast entity. Your live routing config is the source.
            </div>
            <div className="tblw" style={{ overflowX: "auto" }}>
              <table className="dt">
                <thead>
                  <tr>
                    <th>Planning group</th><th>Queues</th><th>ACD skills</th><th>Languages</th><th style={{ width: 30 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {planningGroups.length === 0 ? (
                    <tr><td colSpan={5} style={{ color: "#8794a8", padding: 18 }}>No planning groups yet.</td></tr>
                  ) : (
                    planningGroups.map((p) => (
                      <tr key={p.id} onClick={() => setEditingPG(p)} style={{ cursor: "pointer" }}>
                        <td><b className="lnk">{p.name}</b></td>
                        <td>{p.queues.map((q) => (<span className="tag" key={q}>{queueById.get(q) ?? q}</span>))}</td>
                        <td>{p.skills.map((s) => (<span className="tag o" key={s}>{s}</span>))}</td>
                        <td>{p.langs.join(", ")}</td>
                        <td style={{ color: "#a9b3c2" }}>⋮</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}

        {tab === "Service Goals" && (
          <>
            <div className="tblw" style={{ overflowX: "auto" }}>
              <table className="dt">
                <thead>
                  <tr>
                    <th>Template</th><th>Service level</th><th>ASA</th><th>Abandon</th><th>Planning groups</th><th style={{ width: 30 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {serviceGoals.length === 0 ? (
                    <tr><td colSpan={6} style={{ color: "#8794a8", padding: 18 }}>No service goals yet.</td></tr>
                  ) : (
                    serviceGoals.map((g) => (
                      <tr key={g.id} onClick={() => setEditingSG(g)} style={{ cursor: "pointer" }}>
                        <td><b className="lnk">{g.name}</b></td>
                        <td>{g.sl}% in {g.sls}s</td>
                        <td>≤ {g.asa}s</td>
                        <td>{g.abn ? `≤ ${g.abn}%` : "—"}</td>
                        <td>{g.pgs.map((id) => (<span className="tag" key={id}>{pgById.get(id)?.name ?? id}</span>))}</td>
                        <td style={{ color: "#a9b3c2" }}>⋮</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}

        {tab === "Forecasts" && (
          <>
            {genError && (
              <div style={{ background: "#fdecea", border: "1px solid #f5c6c0", color: "#b3261e", borderRadius: 5, padding: "8px 11px", fontSize: 12.5, marginBottom: 10 }}>
                {genError}
              </div>
            )}
            {forecasts.length === 0 ? (
              <div style={{ background: "#fff", border: "1px dashed #ccd4e0", borderRadius: 10, padding: 26, textAlign: "center", color: "#8794a8", fontSize: 13 }}>
                No forecast yet — Generate derives weekly volume &amp; AHT per planning group from interaction history (ABM: automatic best method).
              </div>
            ) : (
              forecasts.map((f) => (
                <ForecastBlock key={f.id} forecast={f} planningGroups={planningGroups} onDelete={() => deleteForecastMutation.mutate(f.id)} />
              ))
            )}
          </>
        )}

        <LegacyHelpPanel topicKey="forecasts" />
      </div>

      {editingPG && (
        <PlanningGroupDrawer
          draft={editingPG}
          queues={queues}
          skills={skills}
          langs={langs}
          saving={savePGMutation.isPending}
          deleting={deletePGMutation.isPending}
          onClose={() => setEditingPG(null)}
          onSave={(v) => savePGMutation.mutate(v)}
          {...(editingPG.id ? { onDelete: () => deletePGMutation.mutate(editingPG.id as string) } : {})}
        />
      )}

      {editingSG && (
        <ServiceGoalDrawer
          draft={editingSG}
          planningGroups={planningGroups}
          saving={saveSGMutation.isPending}
          deleting={deleteSGMutation.isPending}
          onClose={() => setEditingSG(null)}
          onSave={(v) => saveSGMutation.mutate(v)}
          {...(editingSG.id ? { onDelete: () => deleteSGMutation.mutate(editingSG.id as string) } : {})}
        />
      )}
    </>
  );
}

function ForecastBlock({ forecast, planningGroups, onDelete }: { forecast: Forecast; planningGroups: PlanningGroup[]; onDelete: () => void }) {
  const pgById = new Map(planningGroups.map((p) => [p.id, p]));
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "2px 0 8px" }}>
        <b style={{ fontSize: 14 }}>{forecast.week}</b>
        <span className="st ok"><span className="d"></span>{forecast.status}</span>
        <span style={{ color: "#8794a8", fontSize: 11.5 }}>generated {new Date(forecast.generatedAt).toLocaleString()}</span>
        <div style={{ flex: 1 }}></div>
        <a className="lnk" style={{ fontSize: 12 }} onClick={onDelete}>Delete</a>
      </div>
      <div className="tblw" style={{ overflowX: "auto" }}>
        <table className="dt">
          <thead>
            <tr>
              <th>Planning group</th><th>Weekly vol</th><th>AHT</th>
              {DAYS.map((d) => <th key={d} style={{ textAlign: "right" }}>{d}</th>)}
            </tr>
          </thead>
          <tbody>
            {Object.entries(forecast.data).map(([pgId, d]) => {
              const p = pgById.get(pgId);
              if (!p) return null;
              return (
                <tr key={pgId}>
                  <td><b>{p.name}</b><br /><span style={{ color: "#8794a8", fontSize: 11 }}>skills: {p.skills.join(", ")}</span></td>
                  <td>{d.vol}</td>
                  <td>{d.aht}s</td>
                  {DAYS.map((day) => <td key={day} style={{ textAlign: "right" }}>{d.days[day] ?? 0}</td>)}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PlanningGroupDrawer({
  draft, queues, skills, langs, saving, deleting, onClose, onSave, onDelete,
}: {
  draft: Omit<PlanningGroup, "id"> & { id?: string };
  queues: QueueOption[];
  skills: string[];
  langs: string[];
  saving: boolean;
  deleting: boolean;
  onClose: () => void;
  onSave: (v: Omit<PlanningGroup, "id"> & { id?: string }) => void;
  onDelete?: () => void;
}) {
  const [form, setForm] = useState(draft);
  const [errors, setErrors] = useState<string[]>([]);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const isNew = !form.id;

  function toggle<K extends "queues" | "skills" | "langs">(key: K, value: string) {
    setForm((f) => ({
      ...f,
      [key]: f[key].includes(value) ? f[key].filter((x) => x !== value) : [...f[key], value],
    }));
  }

  function handleSave() {
    const errs: string[] = [];
    if (form.name.trim().length < 2) errs.push("Name is required.");
    if (errs.length) { setErrors(errs); return; }
    onSave({ ...form, name: form.name.trim() });
  }

  if (confirmingDelete && onDelete) {
    return (
      <LegacyDrawer>
        <div id="scrim" onClick={() => setConfirmingDelete(false)} />
        <ConfirmDialogBox
          message={<>Delete planning group <b>{form.name}</b>?</>}
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
      <div id="drw">
        <div className="dh">
          <h2>{isNew ? "New Planning Group" : `Edit — ${form.name}`}</h2>
          <div className="x" onClick={onClose}>×</div>
        </div>
        <div className="db">
          {errors.length > 0 && (
            <div style={{ background: "#fdecea", border: "1px solid #f5c6c0", color: "#b3261e", borderRadius: 5, padding: "8px 11px", fontSize: 12.5, marginBottom: 10 }}>
              {errors.map((e, i) => <div key={i}>{e}</div>)}
            </div>
          )}
          <div className="fld">
            <label>Name *</label>
            <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
          </div>
          <div className="sect">Route paths — queues</div>
          {queues.map((q) => (
            <label key={q.id} style={{ display: "flex", alignItems: "center", gap: 6, padding: "3px 0", fontSize: 12.5 }}>
              <input type="checkbox" checked={form.queues.includes(q.id)} onChange={() => toggle("queues", q.id)} style={{ width: "auto" }} />
              {q.name}
            </label>
          ))}
          <div className="sect">ACD skills (from Routing › Skills)</div>
          {skills.map((s) => (
            <label key={s} style={{ display: "inline-flex", alignItems: "center", gap: 5, margin: "0 12px 6px 0", fontSize: 12.5 }}>
              <input type="checkbox" checked={form.skills.includes(s)} onChange={() => toggle("skills", s)} style={{ width: "auto" }} />
              {s}
            </label>
          ))}
          <div className="sect">Languages</div>
          {langs.map((l) => (
            <label key={l} style={{ display: "inline-flex", alignItems: "center", gap: 5, margin: "0 12px 6px 0", fontSize: 12.5 }}>
              <input type="checkbox" checked={form.langs.includes(l)} onChange={() => toggle("langs", l)} style={{ width: "auto" }} />
              {l}
            </label>
          ))}
          {onDelete && (
            <div style={{ marginTop: 10 }}>
              <LegacyBtn ghost disabled={deleting} onClick={() => setConfirmingDelete(true)}>
                {deleting ? "Deleting…" : "Delete planning group"}
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

function ServiceGoalDrawer({
  draft, planningGroups, saving, deleting, onClose, onSave, onDelete,
}: {
  draft: Omit<ServiceGoal, "id"> & { id?: string };
  planningGroups: PlanningGroup[];
  saving: boolean;
  deleting: boolean;
  onClose: () => void;
  onSave: (v: Omit<ServiceGoal, "id"> & { id?: string }) => void;
  onDelete?: () => void;
}) {
  const [form, setForm] = useState(draft);
  const [errors, setErrors] = useState<string[]>([]);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const isNew = !form.id;

  function togglePg(id: string) {
    setForm((f) => ({ ...f, pgs: f.pgs.includes(id) ? f.pgs.filter((x) => x !== id) : [...f.pgs, id] }));
  }

  function handleSave() {
    const errs: string[] = [];
    if (form.name.trim().length < 2) errs.push("Template name is required.");
    if (errs.length) { setErrors(errs); return; }
    onSave({
      ...form,
      name: form.name.trim(),
      sl: Number(form.sl) || 80,
      sls: Number(form.sls) || 20,
      asa: Number(form.asa) || 30,
      abn: Number(form.abn) || 0,
    });
  }

  // Keeps a numeric field visually empty while the user is mid-edit instead
  // of snapping to 0 on every keystroke that clears it — handleSave clamps
  // back to a sane default above at save time.
  function numField<K extends "sl" | "sls" | "asa" | "abn">(key: K, raw: string) {
    setForm((f) => ({ ...f, [key]: (raw === "" ? "" : parseInt(raw, 10) || 0) as unknown as number }));
  }

  if (confirmingDelete && onDelete) {
    return (
      <LegacyDrawer>
        <div id="scrim" onClick={() => setConfirmingDelete(false)} />
        <ConfirmDialogBox
          message={<>Delete service goal <b>{form.name}</b>?</>}
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
      <div id="drw">
        <div className="dh">
          <h2>{isNew ? "New Service Goal" : `Edit — ${form.name}`}</h2>
          <div className="x" onClick={onClose}>×</div>
        </div>
        <div className="db">
          {errors.length > 0 && (
            <div style={{ background: "#fdecea", border: "1px solid #f5c6c0", color: "#b3261e", borderRadius: 5, padding: "8px 11px", fontSize: 12.5, marginBottom: 10 }}>
              {errors.map((e, i) => <div key={i}>{e}</div>)}
            </div>
          )}
          <div className="fld">
            <label>Template name *</label>
            <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <div className="fld" style={{ flex: 1 }}>
              <label>Service level %</label>
              <input type="number" value={form.sl} onChange={(e) => numField("sl", e.target.value)} />
            </div>
            <div className="fld" style={{ flex: 1 }}>
              <label>within seconds</label>
              <input type="number" value={form.sls} onChange={(e) => numField("sls", e.target.value)} />
            </div>
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <div className="fld" style={{ flex: 1 }}>
              <label>ASA target (s)</label>
              <input type="number" value={form.asa} onChange={(e) => numField("asa", e.target.value)} />
            </div>
            <div className="fld" style={{ flex: 1 }}>
              <label>Max abandon %</label>
              <input type="number" value={form.abn} onChange={(e) => numField("abn", e.target.value)} />
            </div>
          </div>
          <div className="sect">Applies to planning groups</div>
          {planningGroups.map((p) => (
            <label key={p.id} style={{ display: "flex", alignItems: "center", gap: 6, padding: "3px 0", fontSize: 12.5 }}>
              <input type="checkbox" checked={form.pgs.includes(p.id)} onChange={() => togglePg(p.id)} style={{ width: "auto" }} />
              {p.name}
            </label>
          ))}
          {onDelete && (
            <div style={{ marginTop: 10 }}>
              <LegacyBtn ghost disabled={deleting} onClick={() => setConfirmingDelete(true)}>
                {deleting ? "Deleting…" : "Delete service goal"}
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
