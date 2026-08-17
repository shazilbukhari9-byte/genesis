import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { LegacyBtn } from "../shared/LegacyBtn";
import { LegacyHelpPanel } from "../shared/LegacyHelpPanel";
import { deleteSimpleEntity, fetchDirectory, upsertSimpleEntity, type SimpleEntityKind } from "./store";
import type { SimpleEntity } from "./types";

const QUERY_KEY = ["people-directory"];

export function SimpleEntityPage({
  kind,
  title,
  hideKey,
  helpKey,
}: {
  kind: SimpleEntityKind;
  title: string;
  hideKey: "__hideSkills" | "__hideLangs";
  helpKey: "skills" | "langs";
}) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<SimpleEntity | { name: string; desc: string } | null>(null);

  const { data, isLoading } = useQuery({ queryKey: QUERY_KEY, queryFn: fetchDirectory });

  const saveMutation = useMutation({
    mutationFn: (entity: Omit<SimpleEntity, "id"> & { id?: string }) => upsertSimpleEntity(kind, entity),
    onSuccess: (updated) => {
      queryClient.setQueryData(QUERY_KEY, updated);
      setEditing(null);
    },
  });
  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteSimpleEntity(kind, id),
    onSuccess: (updated) => queryClient.setQueryData(QUERY_KEY, updated),
  });

  const list = data?.[kind] ?? [];
  const assignedCount = (name: string) =>
    (data?.people ?? []).filter((p) => (kind === "skills" ? name in p.skills : p.langs.includes(name))).length;

  function goToAdminIndex(): void {
    const win = window as unknown as { adminIndex?: () => void } & Record<string, (() => void) | undefined>;
    win[hideKey]?.();
    win.adminIndex?.();
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
            <LegacyBtn onClick={() => setEditing({ name: "", desc: "" })}>+ Add</LegacyBtn>
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
              ) : (
                list.map((e) => (
                  <tr key={e.id} onClick={() => setEditing(e)} style={{ cursor: "pointer" }}>
                    <td><b className="lnk">{e.name}</b></td>
                    <td>{e.desc ?? "—"}</td>
                    <td>{assignedCount(e.name)} people</td>
                    <td>
                      <span
                        style={{ color: "#b3261e", fontSize: 11.5 }}
                        onClick={(evt) => {
                          evt.stopPropagation();
                          deleteMutation.mutate(e.id);
                        }}
                      >
                        Delete
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <LegacyHelpPanel topicKey={helpKey} />
      </div>

      {editing && (
        <div>
          <div id="scrim" onClick={() => setEditing(null)} />
          <div id="drw" style={{ height: "auto", top: "26%", bottom: "auto", borderRadius: "8px 0 0 8px" }}>
            <div className="dh">
              <h2>{"id" in editing ? "Edit" : "Add"}</h2>
              <div className="x" onClick={() => setEditing(null)}>×</div>
            </div>
            <div className="db">
              <div className="fld">
                <label>Name</label>
                <input value={editing.name} onChange={(e) => setEditing((d) => (d ? { ...d, name: e.target.value } : d))} />
              </div>
              <div className="fld">
                <label>Description</label>
                <input
                  value={editing.desc ?? ""}
                  onChange={(e) => setEditing((d) => (d ? { ...d, desc: e.target.value } : d))}
                />
              </div>
            </div>
            <div className="df">
              <LegacyBtn secondary onClick={() => setEditing(null)} disabled={saveMutation.isPending}>Cancel</LegacyBtn>
              <LegacyBtn onClick={() => saveMutation.mutate(editing)} disabled={saveMutation.isPending || !editing.name}>
                {saveMutation.isPending ? "Saving…" : "Save"}
              </LegacyBtn>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
