import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { LegacyBtn } from "../shared/LegacyBtn";
import { LegacyDrawer } from "../shared/LegacyDrawer";
import { ConfirmDialogBox } from "../shared/ConfirmDialog";
import { LegacyHelpPanel } from "../shared/LegacyHelpPanel";
import {
  deleteRecordingPolicy,
  fetchQueuesForPolicies,
  fetchRecordingPolicies,
  upsertRecordingPolicy,
} from "./recordingPoliciesService";
import type { Queue, RecordingPolicy } from "./types";

const POLICIES_KEY = ["recording-policies"];
const QUEUES_KEY = ["recording-policies-queues"];

const MEDIA_OPTIONS = ["Voice", "Screen"];

type Draft = Omit<RecordingPolicy, "id"> & { id?: string };

function emptyDraft(): Draft {
  return { name: "", media: ["Voice"], queues: [], retention: 90, pct: 100, active: true };
}

function goToAdminIndex(): void {
  const win = window as unknown as { adminIndex?: () => void; __hideRecpol?: () => void };
  win.__hideRecpol?.();
  win.adminIndex?.();
}

function queueNames(ids: string[], queues: Queue[]): string {
  if (!ids.length) return "All queues";
  const byId = new Map(queues.map((q) => [q.id, q.name]));
  return ids.map((id) => byId.get(id) ?? id).join(", ");
}

export function RecordingPoliciesPage() {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<Draft | null>(null);

  const { data: policies = [], isLoading } = useQuery({ queryKey: POLICIES_KEY, queryFn: fetchRecordingPolicies });
  const { data: queues = [] } = useQuery({ queryKey: QUEUES_KEY, queryFn: fetchQueuesForPolicies });

  const saveMutation = useMutation({
    mutationFn: upsertRecordingPolicy,
    onSuccess: (updated) => {
      queryClient.setQueryData(POLICIES_KEY, updated);
      setEditing(null);
    },
  });
  const deleteMutation = useMutation({
    mutationFn: deleteRecordingPolicy,
    onSuccess: (updated) => {
      queryClient.setQueryData(POLICIES_KEY, updated);
      setEditing(null);
    },
  });

  return (
    <>
      <div className="phd">
        <div className="bc">
          <a onClick={goToAdminIndex}>Admin</a> › Quality
        </div>
        <div className="tt">
          <h1>Recording Policies</h1>
          <div className="rt">
            <LegacyBtn onClick={() => setEditing(emptyDraft())}>+ Create Policy</LegacyBtn>
          </div>
        </div>
        <div className="tabs">
          <div className="tb on">Policies ({policies.length})</div>
        </div>
      </div>

      <div className="pbody">
        <div className="tblw" style={{ overflowX: "auto" }}>
          <table className="dt">
            <thead>
              <tr>
                <th>Policy</th>
                <th>Media</th>
                <th>Queues</th>
                <th>Sample</th>
                <th>Retention</th>
                <th>State</th>
                <th style={{ width: 30 }}></th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={7} style={{ color: "#8794a8", padding: 18 }}>Loading…</td>
                </tr>
              ) : policies.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ color: "#8794a8", padding: 18 }}>
                    No recording policies yet — use "+ Create Policy" to add one.
                  </td>
                </tr>
              ) : (
                policies.map((p) => (
                  <tr key={p.id} onClick={() => setEditing(p)} style={{ cursor: "pointer" }}>
                    <td><b className="lnk">{p.name}</b></td>
                    <td>
                      {p.media.map((m) => (
                        <span className="tag" key={m} style={{ marginRight: 4 }}>{m}</span>
                      ))}
                    </td>
                    <td>{queueNames(p.queues, queues)}</td>
                    <td>{p.pct}%</td>
                    <td>{p.retention} days</td>
                    <td>
                      {p.active ? (
                        <span className="st ok"><span className="d"></span>Active</span>
                      ) : (
                        <span className="st" style={{ color: "#8a94a6" }}>
                          <span className="d" style={{ background: "#8a94a6" }}></span>Disabled
                        </span>
                      )}
                    </td>
                    <td style={{ color: "#a9b3c2" }}>⋮</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <LegacyHelpPanel topicKey="recpol" />
      </div>

      {editing && (
        <PolicyDrawer
          draft={editing}
          queues={queues}
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

function PolicyDrawer({
  draft,
  queues,
  saving,
  deleting,
  onClose,
  onSave,
  onDelete,
}: {
  draft: Draft;
  queues: Queue[];
  saving: boolean;
  deleting: boolean;
  onClose: () => void;
  onSave: (value: Draft) => void;
  onDelete?: () => void;
}) {
  const [form, setForm] = useState(draft);
  const [errors, setErrors] = useState<string[]>([]);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const isNew = !form.id;

  function toggleMedia(m: string) {
    setForm((f) => ({
      ...f,
      media: f.media.includes(m) ? f.media.filter((x) => x !== m) : [...f.media, m],
    }));
  }

  function toggleQueue(id: string) {
    setForm((f) => ({
      ...f,
      queues: f.queues.includes(id) ? f.queues.filter((x) => x !== id) : [...f.queues, id],
    }));
  }

  function handleSave() {
    const errs: string[] = [];
    const name = form.name.trim();
    if (name.length < 2) errs.push("Policy name is required.");
    if (!form.media.length) errs.push("Select at least one media type.");
    if (errs.length) {
      setErrors(errs);
      return;
    }
    const pct = Math.max(1, Math.min(100, form.pct || 100));
    const retention = Math.max(1, form.retention || 90);
    onSave({ ...form, name, pct, retention });
  }

  if (confirmingDelete && onDelete) {
    return (
      <LegacyDrawer>
        <div id="scrim" onClick={() => setConfirmingDelete(false)} />
        <ConfirmDialogBox
          message={<>Delete recording policy <b>{form.name}</b>? Existing recordings are kept per retention.</>}
          onCancel={() => setConfirmingDelete(false)}
          onConfirm={() => {
            // Close right away instead of waiting on the delete request to
            // resolve — onDelete()/the mutation still runs in the
            // background, but the UI shouldn't look stuck while in flight.
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
          <h2>{isNew ? "Create Recording Policy" : `Edit — ${form.name}`}</h2>
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
            <label>Policy name *</label>
            <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
          </div>
          <div className="fld">
            <label>Media recorded</label>
            <div>
              {MEDIA_OPTIONS.map((m) => (
                <label key={m} style={{ display: "inline-flex", alignItems: "center", gap: 5, marginRight: 14, fontSize: 12.5 }}>
                  <input type="checkbox" checked={form.media.includes(m)} onChange={() => toggleMedia(m)} style={{ width: "auto" }} />
                  {m}
                </label>
              ))}
            </div>
          </div>
          <div className="fld">
            <label>Queues (none checked = all queues)</label>
            {queues.length === 0 && <div style={{ fontSize: 12, color: "#8794a8" }}>No queues configured yet.</div>}
            {queues.map((q) => (
              <label key={q.id} style={{ display: "flex", alignItems: "center", gap: 6, padding: "3px 0", fontSize: 12.5 }}>
                <input type="checkbox" checked={form.queues.includes(q.id)} onChange={() => toggleQueue(q.id)} style={{ width: "auto" }} />
                {q.name}
              </label>
            ))}
          </div>
          <div className="fld">
            <label>Sample percentage (of eligible interactions)</label>
            <input
              type="number"
              min={1}
              max={100}
              value={form.pct}
              onChange={(e) => {
                // Keep the field visually empty while the user is mid-edit
                // instead of snapping to 0 on every keystroke that clears
                // it — handleSave's `form.pct || 100` clamp coerces an
                // empty value back to a sane default at save time.
                const raw = e.target.value;
                setForm((f) => ({ ...f, pct: (raw === "" ? "" : parseInt(raw, 10) || 0) as unknown as number }));
              }}
            />
          </div>
          <div className="fld">
            <label>Retention (days)</label>
            <input
              type="number"
              min={1}
              value={form.retention}
              onChange={(e) => {
                const raw = e.target.value;
                setForm((f) => ({ ...f, retention: (raw === "" ? "" : parseInt(raw, 10) || 0) as unknown as number }));
              }}
            />
          </div>
          <div className="tgl">
            <input
              type="checkbox"
              checked={form.active}
              onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))}
              style={{ width: "auto", marginRight: 4 }}
            />
            Policy active
          </div>
          {onDelete && (
            <div style={{ marginTop: 10 }}>
              <LegacyBtn ghost disabled={deleting} onClick={() => setConfirmingDelete(true)}>
                {deleting ? "Deleting…" : "Delete policy"}
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
