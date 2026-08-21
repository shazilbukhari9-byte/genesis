import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { LegacyBtn } from "../shared/LegacyBtn";
import { LegacyHelpPanel } from "../shared/LegacyHelpPanel";
import { deleteSimpleEntity, fetchDirectory, upsertSimpleEntity, type SimpleEntityKind } from "./store";
import type { Person, SimpleEntity } from "./types";

const QUERY_KEY = ["people-directory"];

type Draft = SimpleEntity | { name: string; desc: string };

export function SimpleEntityPage({
  kind,
  title,
  label,
  hideKey,
  helpKey,
}: {
  kind: SimpleEntityKind;
  title: string;
  label: string;
  hideKey: "__hideSkills" | "__hideLangs";
  helpKey: "skills" | "langs";
}) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<Draft | null>(null);
  const [errors, setErrors] = useState<string[]>([]);

  const { data, isLoading } = useQuery({ queryKey: QUERY_KEY, queryFn: fetchDirectory });

  function closeDrawer(): void {
    setEditing(null);
    setErrors([]);
  }

  const saveMutation = useMutation({
    mutationFn: (entity: Omit<SimpleEntity, "id"> & { id?: string }) => upsertSimpleEntity(kind, entity),
    onSuccess: (updated) => {
      queryClient.setQueryData(QUERY_KEY, updated);
      closeDrawer();
    },
  });
  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteSimpleEntity(kind, id),
    onSuccess: (updated) => {
      queryClient.setQueryData(QUERY_KEY, updated);
      // Without this the drawer stayed open over a row that no longer exists.
      closeDrawer();
    },
  });

  const list = data?.[kind] ?? [];
  const people: Person[] = data?.people ?? [];
  const assignedCount = (name: string) =>
    people.filter((p) => (kind === "skills" ? name in p.skills : p.langs.includes(name))).length;

  function openDrawer(entity: Draft): void {
    setEditing(entity);
    setErrors([]);
  }

  function goToAdminIndex(): void {
    const win = window as unknown as { adminIndex?: () => void } & Record<string, (() => void) | undefined>;
    win[hideKey]?.();
    win.adminIndex?.();
  }

  // Mirrors the prototype's saveSimple(): a unique name of at least two
  // characters, checked case-insensitively against every other entity of
  // this kind.
  function handleSave(draft: Draft): void {
    const name = draft.name.trim();
    const existingId = "id" in draft ? draft.id : undefined;
    const errs: string[] = [];
    // The duplicate check below reads the loaded list, so saving before the
    // directory arrives would compare against nothing and let a duplicate
    // through — refuse rather than check against an empty list.
    if (isLoading || !data) {
      setErrors(["Still loading the directory — try again in a moment."]);
      return;
    }
    if (name.length < 2) errs.push(`${label} name must be at least 2 characters.`);
    if (list.some((e) => e.name.toLowerCase() === name.toLowerCase() && e.id !== existingId)) {
      errs.push(`A ${label.toLowerCase()} named "${name}" already exists.`);
    }
    if (errs.length) {
      setErrors(errs);
      return;
    }
    saveMutation.mutate({ ...draft, name, desc: (draft.desc ?? "").trim() });
  }

  function handleDelete(entity: SimpleEntity): void {
    const count = assignedCount(entity.name);
    const warning = count
      ? ` It is assigned to ${count} agent${count === 1 ? "" : "s"}; the assignment will be removed.`
      : "";
    if (window.confirm(`Delete ${entity.name}?${warning}`)) deleteMutation.mutate(entity.id);
  }

  return (
    <>
      <div className="phd">
        <div className="bc">
          <a onClick={goToAdminIndex}>Admin</a> › People &amp; Permissions
        </div>
        <div className="tt">
          <h1>{title}</h1>
          <div className="rt">
            <LegacyBtn onClick={() => openDrawer({ name: "", desc: "" })}>+ Add</LegacyBtn>
          </div>
        </div>
        <div className="tabs">
          <div className="tb on">All ({list.length})</div>
        </div>
      </div>

      <div className="pbody">
        <div className="tblw">
          <table className="dt">
            <thead>
              <tr>
                <th>Name</th>
                <th>Description</th>
                <th>Assigned to</th>
                <th style={{ width: 30 }}></th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={4} style={{ color: "#8794a8", padding: 18 }}>Loading…</td>
                </tr>
              ) : list.length === 0 ? (
                <tr>
                  <td colSpan={4} style={{ color: "#8794a8", padding: 18 }}>
                    No {title.toLowerCase()} yet — use “+ Add” to create one.
                  </td>
                </tr>
              ) : (
                list.map((e) => {
                  const count = assignedCount(e.name);
                  return (
                    <tr key={e.id} onClick={() => openDrawer(e)} style={{ cursor: "pointer" }}>
                      <td><b className="lnk">{e.name}</b></td>
                      <td>{e.desc || "—"}</td>
                      <td>
                        {count} agent{count === 1 ? "" : "s"}
                      </td>
                      <td>
                        <span
                          className="lnk"
                          style={{ color: "#b3261e", fontSize: 11.5 }}
                          onClick={(evt) => {
                            evt.stopPropagation();
                            handleDelete(e);
                          }}
                        >
                          Delete
                        </span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <LegacyHelpPanel topicKey={helpKey} />
      </div>

      {editing && (
        <div>
          <div id="scrim" onClick={closeDrawer} />
          <div id="drw" style={{ height: "auto", top: "26%", bottom: "auto", borderRadius: "8px 0 0 8px" }}>
            <div className="dh">
              <h2>{"id" in editing ? `Edit ${label}` : `Add ${label}`}</h2>
              <div className="x" onClick={closeDrawer}>×</div>
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
                <label>{label} name *</label>
                <input
                  value={editing.name}
                  onChange={(e) => setEditing((d) => (d ? { ...d, name: e.target.value } : d))}
                />
              </div>
              <div className="fld">
                <label>Description</label>
                <input
                  value={editing.desc ?? ""}
                  onChange={(e) => setEditing((d) => (d ? { ...d, desc: e.target.value } : d))}
                />
              </div>
              {"id" in editing && (
                <div className="fld" style={{ marginTop: 14 }}>
                  <LegacyBtn secondary onClick={() => handleDelete(editing)} disabled={deleteMutation.isPending}>
                    {deleteMutation.isPending ? "Deleting…" : `Delete ${label.toLowerCase()}`}
                  </LegacyBtn>
                </div>
              )}
            </div>
            <div className="df">
              <LegacyBtn secondary onClick={closeDrawer} disabled={saveMutation.isPending}>Cancel</LegacyBtn>
              <LegacyBtn onClick={() => handleSave(editing)} disabled={saveMutation.isPending || isLoading}>
                {saveMutation.isPending ? "Saving…" : "Save"}
              </LegacyBtn>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
