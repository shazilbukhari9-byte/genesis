import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { LegacyBtn } from "../shared/LegacyBtn";
import { LegacyHelpPanel } from "../shared/LegacyHelpPanel";
import { toast } from "../shared/toast";
import { deleteGroup, fetchDirectory, upsertGroup } from "./store";
import type { Group, Person } from "./types";

const QUERY_KEY = ["people-directory"];

function goToAdminIndex(): void {
  const win = window as unknown as { adminIndex?: () => void; __hideGroups?: () => void };
  win.__hideGroups?.();
  win.adminIndex?.();
}

function emptyGroup(): Omit<Group, "id"> {
  return { name: "", type: "Official", ext: "", ring: "Broadcast", members: [], vm: false };
}

export function GroupsPage() {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<Group | Omit<Group, "id"> | null>(null);

  const { data, isLoading } = useQuery({ queryKey: QUERY_KEY, queryFn: fetchDirectory });

  const saveMutation = useMutation({
    mutationFn: upsertGroup,
    onSuccess: (updated, variables) => {
      queryClient.setQueryData(QUERY_KEY, updated);
      setEditing(null);
      toast(`Group saved — <b>${variables.name}</b>`);
    },
  });
  const deleteMutation = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => deleteGroup(id, name),
    onSuccess: (updated) => {
      queryClient.setQueryData(QUERY_KEY, updated);
      setEditing(null);
      toast("Group deleted");
    },
  });

  const groups = data?.groups ?? [];

  return (
    <>
      <div className="phd">
        <div className="bc">
          <a onClick={goToAdminIndex}>Admin</a> › Directory
        </div>
        <div className="tt">
          <h1>Groups</h1>
          <div className="rt">
            <LegacyBtn onClick={() => setEditing(emptyGroup())}>+ Add Group</LegacyBtn>
          </div>
        </div>
        <div className="tabs">
          <div className="tb on">All Groups ({groups.length})</div>
        </div>
      </div>

      <div className="pbody">
        <div className="tblw">
          <table className="dt">
            <thead>
              <tr>
                <th>Group</th>
                <th>Type</th>
                <th>Members</th>
                <th>Group number</th>
                <th>Ring style</th>
                <th>Voicemail</th>
                <th style={{ width: 30 }}></th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={7} style={{ color: "#8794a8", padding: 18 }}>Loading…</td>
                </tr>
              ) : (
                groups.map((g) => (
                  <tr key={g.id} onClick={() => setEditing(g)} style={{ cursor: "pointer" }}>
                    <td><b className="lnk">{g.name}</b></td>
                    <td>
                      <span className={g.type === "Official" ? "tag" : "tag o"}>{g.type}</span>
                    </td>
                    <td>{g.members.length}</td>
                    <td>{g.ext || "—"}</td>
                    <td>{g.ring}</td>
                    <td>{g.vm ? "Yes" : "No"}</td>
                    <td style={{ color: "#a9b3c2" }}>⋮</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <LegacyHelpPanel topicKey="groups" />
      </div>

      {editing && (
        <GroupDrawer
          group={editing}
          groups={groups}
          people={data?.people ?? []}
          saving={saveMutation.isPending}
          onClose={() => setEditing(null)}
          onSave={(value) => saveMutation.mutate(value)}
          {...("id" in editing ? { onDelete: () => deleteMutation.mutate({ id: editing.id, name: editing.name }) } : {})}
        />
      )}
    </>
  );
}

const RING_HELP: Record<Group["ring"], string> = {
  Broadcast: "All members ring at the same time; first to answer takes the call.",
  Sequential: "Members ring one at a time in order until someone answers.",
  Rotary: "Rings start from a rotating position each time, spreading load evenly.",
};

function GroupDrawer({
  group,
  groups,
  people,
  saving,
  onClose,
  onSave,
  onDelete,
}: {
  group: Group | Omit<Group, "id">;
  groups: Group[];
  people: Person[];
  saving: boolean;
  onClose: () => void;
  onSave: (value: Group | Omit<Group, "id">) => void;
  onDelete?: () => void;
}) {
  const [draft, setDraft] = useState(group);
  const [errors, setErrors] = useState<string[]>([]);
  const isNew = !("id" in draft);

  function toggleMember(id: string) {
    setDraft((d) => ({
      ...d,
      members: d.members.includes(id) ? d.members.filter((m) => m !== id) : [...d.members, id],
    }));
  }

  function validate(): string[] {
    const errs: string[] = [];
    const name = draft.name.trim();
    if (name.length < 2) errs.push("Group name is required.");
    const existingId = "id" in draft ? draft.id : undefined;
    if (groups.some((g) => g.name.toLowerCase() === name.toLowerCase() && g.id !== existingId)) {
      errs.push("Group name already exists.");
    }
    if (draft.ext && !/^\d{3,6}$/.test(draft.ext)) errs.push("Group number must be 3–6 digits.");
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
      <div id="drw">
        <div className="dh">
          <h2>{isNew ? "Add Group" : `Edit — ${draft.name}`}</h2>
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
            <input value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} />
          </div>
          <div className="fld">
            <label>Type</label>
            <select value={draft.type} onChange={(e) => setDraft((d) => ({ ...d, type: e.target.value as Group["type"] }))}>
              <option>Official</option>
              <option>Social</option>
            </select>
          </div>

          <div className="sect">Group ring</div>
          <div className="fld">
            <label>Group number / extension</label>
            <input value={draft.ext} onChange={(e) => setDraft((d) => ({ ...d, ext: e.target.value }))} placeholder="7100" />
            {draft.ext && !/^\d{3,6}$/.test(draft.ext) && (
              <div style={{ fontSize: 11.5, color: "#b3261e", marginTop: 4 }}>Extension must be 3–6 digits.</div>
            )}
          </div>
          <div className="fld">
            <label>Ring style</label>
            <select value={draft.ring} onChange={(e) => setDraft((d) => ({ ...d, ring: e.target.value as Group["ring"] }))}>
              <option>Broadcast</option>
              <option>Sequential</option>
              <option>Rotary</option>
            </select>
            <div style={{ fontSize: 11.5, color: "#8794a8", marginTop: 4 }}>{RING_HELP[draft.ring]}</div>
          </div>
          <div className="fld">
            <div className="tgl">
              <input
                type="checkbox"
                checked={draft.vm}
                onChange={(e) => setDraft((d) => ({ ...d, vm: e.target.checked }))}
                style={{ width: "auto", marginRight: 6 }}
              />
              Enable group voicemail
            </div>
          </div>

          <div className="sect">Members</div>
          <div className="fld">
            {people.map((p) => (
              <label key={p.id} style={{ display: "block", fontSize: 12.5, marginBottom: 4 }}>
                <input
                  type="checkbox"
                  checked={draft.members.includes(p.id)}
                  onChange={() => toggleMember(p.id)}
                  style={{ width: "auto", marginRight: 6 }}
                />
                {p.name}
              </label>
            ))}
          </div>

          {"id" in draft && onDelete && (
            <div className="fld" style={{ marginTop: 14 }}>
              <LegacyBtn
                secondary
                onClick={() => {
                  if (window.confirm(`Delete group "${draft.name}"?`)) onDelete();
                }}
              >
                Delete group
              </LegacyBtn>
            </div>
          )}
        </div>
        <div className="df">
          <LegacyBtn secondary onClick={onClose} disabled={saving}>Cancel</LegacyBtn>
          <LegacyBtn onClick={handleSave} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </LegacyBtn>
        </div>
      </div>
    </>
  );
}
