import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { LegacyBtn } from "../shared/LegacyBtn";
import { LegacyHelpPanel } from "../shared/LegacyHelpPanel";
import { deleteDivision, fetchDirectory, upsertDivision } from "./store";
import type { Division, Person } from "./types";

const QUERY_KEY = ["people-directory"];

function goToAdminIndex(): void {
  const win = window as unknown as { adminIndex?: () => void; __hideDivisions?: () => void };
  win.__hideDivisions?.();
  win.adminIndex?.();
}

export function DivisionsPage() {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<Division | { name: string; desc: string } | null>(null);

  const { data, isLoading } = useQuery({ queryKey: QUERY_KEY, queryFn: fetchDirectory });

  const saveMutation = useMutation({
    mutationFn: upsertDivision,
    onSuccess: (updated) => {
      queryClient.setQueryData(QUERY_KEY, updated);
      setEditing(null);
    },
  });
  const deleteMutation = useMutation({
    mutationFn: deleteDivision,
    onSuccess: (updated) => queryClient.setQueryData(QUERY_KEY, updated),
  });

  const divisions = data?.divisions ?? [];
  const userCount = (id: string) => (data?.people ?? []).filter((p) => p.division === id).length;

  return (
    <>
      <div className="phd">
        <div className="bc">
          <a onClick={goToAdminIndex}>Admin</a> › People &amp; Permissions
        </div>
        <div className="tt">
          <h1>Divisions</h1>
          <div className="rt">
            <LegacyBtn disabled={divisions.length >= 50} onClick={() => setEditing({ name: "", desc: "" })}>
              + Add Division
            </LegacyBtn>
          </div>
        </div>
        <div className="tabs">
          <div className="tb on">All Divisions ({divisions.length}/50)</div>
        </div>
      </div>

      <div className="pbody">
        <div className="tblw">
          <table className="dt">
            <thead>
              <tr>
                <th>Division</th>
                <th>Description</th>
                <th>Users</th>
                <th style={{ width: 30 }}></th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={4} style={{ color: "#8794a8", padding: 18 }}>Loading…</td>
                </tr>
              ) : (
                divisions.map((d) => (
                  <tr key={d.id} onClick={() => setEditing(d)} style={{ cursor: "pointer" }}>
                    <td>
                      <b className="lnk">{d.name}</b>
                      {d.home && <span className="tag" style={{ marginLeft: 8 }}>Home</span>}
                    </td>
                    <td>{d.desc}</td>
                    <td>{userCount(d.id)}</td>
                    <td style={{ color: "#a9b3c2" }}>⋮</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <LegacyHelpPanel topicKey="divisions" />
      </div>

      {editing && (
        <DivisionDrawer
          division={editing}
          divisions={divisions}
          members={"id" in editing ? (data?.people ?? []).filter((p) => p.division === editing.id) : []}
          saving={saveMutation.isPending}
          onClose={() => setEditing(null)}
          onSave={(value) => saveMutation.mutate(value)}
          {...("id" in editing ? { onDelete: () => deleteMutation.mutate(editing.id) } : {})}
        />
      )}
    </>
  );
}

function DivisionDrawer({
  division,
  divisions,
  members,
  saving,
  onClose,
  onSave,
  onDelete,
}: {
  division: Division | { name: string; desc: string };
  divisions: Division[];
  members: Person[];
  saving: boolean;
  onClose: () => void;
  onSave: (value: Division | { name: string; desc: string }) => void;
  onDelete?: () => void;
}) {
  const [draft, setDraft] = useState(division);
  const [errors, setErrors] = useState<string[]>([]);
  const isHome = "home" in draft && draft.home;
  const isNew = !("id" in draft);

  function validate(): string[] {
    const errs: string[] = [];
    const name = draft.name.trim();
    if (name.length < 2) errs.push("Division name is required.");
    const existingId = "id" in draft ? draft.id : undefined;
    if (divisions.some((d) => d.name.toLowerCase() === name.toLowerCase() && d.id !== existingId)) {
      errs.push("A division with this name already exists.");
    }
    if (isNew && divisions.length >= 50) errs.push("Division limit reached (50).");
    return errs;
  }

  function handleSave() {
    const errs = validate();
    if (errs.length) {
      setErrors(errs);
      return;
    }
    onSave({ ...draft, name: draft.name.trim() });
  }

  return (
    <>
      <div id="scrim" onClick={onClose} />
      <div id="drw" style={{ height: "auto", top: "26%", bottom: "auto", borderRadius: "8px 0 0 8px" }}>
        <div className="dh">
          <h2>{"id" in draft ? `Edit — ${draft.name}` : "Add Division"}</h2>
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
            <label>Name *</label>
            <input value={draft.name} disabled={isHome} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} />
          </div>
          <div className="fld">
            <label>Description</label>
            <input value={draft.desc} onChange={(e) => setDraft((d) => ({ ...d, desc: e.target.value }))} />
          </div>
          {"id" in draft && (
            <>
              <div className="sect">Users ({members.length})</div>
              {members.length === 0 && <div style={{ fontSize: 12.5, color: "#8794a8" }}>No users in this division.</div>}
              {members.map((m) => (
                <div key={m.id} style={{ fontSize: 12.5, padding: "4px 0" }}>
                  {m.name} <span style={{ color: "#8794a8" }}>— {m.title}</span>
                </div>
              ))}
            </>
          )}
          {!isHome && onDelete && (
            <div className="fld" style={{ marginTop: 14 }}>
              <LegacyBtn
                secondary
                onClick={() => {
                  const warning = members.length
                    ? ` ${members.length} user(s) will be moved to the Home division.`
                    : "";
                  if (window.confirm(`Delete division "${draft.name}"?${warning}`)) onDelete();
                }}
              >
                Delete division
              </LegacyBtn>
            </div>
          )}
        </div>
        <div className="df">
          <LegacyBtn secondary onClick={onClose} disabled={saving}>Cancel</LegacyBtn>
          <LegacyBtn onClick={handleSave} disabled={saving}>
            {saving ? "Saving…" : "id" in draft ? "Save changes" : "Create division"}
          </LegacyBtn>
        </div>
      </div>
    </>
  );
}
