import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { LegacyBtn } from "../shared/LegacyBtn";
import { LegacyHelpPanel } from "../shared/LegacyHelpPanel";
import { toast } from "../shared/toast";
import { deleteRole, fetchDirectory, upsertRole } from "./store";
import { PERMISSION_DOMAINS, type Person, type Role } from "./types";

const QUERY_KEY = ["people-directory"];

function goToAdminIndex(): void {
  const win = window as unknown as { adminIndex?: () => void; __hideRoles?: () => void };
  win.__hideRoles?.();
  win.adminIndex?.();
}

type DraftRole = Role | { name: string; desc: string; perms: string[] };

export function RolesPage() {
  const queryClient = useQueryClient();
  const [editingId, setEditingId] = useState<string | "new" | null>(null);

  const { data, isLoading } = useQuery({ queryKey: QUERY_KEY, queryFn: fetchDirectory });

  const saveMutation = useMutation({
    mutationFn: upsertRole,
    onSuccess: (updated, variables) => {
      queryClient.setQueryData(QUERY_KEY, updated);
      setEditingId(null);
      toast(("id" in variables && variables.id ? "Role saved — " : "Role created — ") + variables.name);
    },
  });
  const deleteMutation = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => deleteRole(id, name),
    onSuccess: (updated) => {
      queryClient.setQueryData(QUERY_KEY, updated);
      setEditingId(null);
      toast("Role deleted");
    },
  });
  const removeMemberMutation = useMutation({
    mutationFn: async ({ userId, roleId }: { userId: string; roleId: string }) => {
      const dir = await fetchDirectory();
      const person = dir.people.find((p) => p.id === userId);
      if (!person) return dir;
      const { upsertPerson } = await import("./store");
      return upsertPerson({ ...person, roles: person.roles.filter((r) => r !== roleId) });
    },
    onSuccess: (updated) => queryClient.setQueryData(QUERY_KEY, updated),
  });
  const copyMutation = useMutation({
    mutationFn: (role: Role) => upsertRole({ name: `Copy of ${role.name}`, desc: role.desc, perms: role.perms }),
    onSuccess: (updated, role) => {
      queryClient.setQueryData(QUERY_KEY, updated);
      setEditingId(null);
      toast(`Role copied — now edit <b>Copy of ${role.name}</b>`);
    },
  });

  const roles = data?.roles ?? [];
  const memberCount = (roleId: string) => (data?.people ?? []).filter((p) => p.roles.includes(roleId)).length;
  const editingRole: DraftRole | null =
    editingId === "new" ? { name: "", desc: "", perms: [] } : editingId ? roles.find((r) => r.id === editingId) ?? null : null;

  return (
    <>
      <div className="phd">
        <div className="bc">
          <a onClick={goToAdminIndex}>Admin</a> › People &amp; Permissions
        </div>
        <div className="tt">
          <h1>Roles / Permissions</h1>
          <div className="rt">
            <LegacyBtn onClick={() => setEditingId("new")}>+ Add Role</LegacyBtn>
          </div>
        </div>
        <div className="tabs">
          <div className="tb on">Roles</div>
        </div>
      </div>

      <div className="pbody">
        <div className="tblw">
          <table className="dt">
            <thead>
              <tr>
                <th>Role</th>
                <th>Description</th>
                <th>Type</th>
                <th>Permissions</th>
                <th>Members</th>
                <th style={{ width: 30 }}></th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={6} style={{ color: "#8794a8", padding: 18 }}>Loading…</td>
                </tr>
              ) : (
                roles.map((r) => (
                  <tr key={r.id} onClick={() => setEditingId(r.id)} style={{ cursor: "pointer" }}>
                    <td><b className="lnk">{r.name}</b></td>
                    <td>{r.desc}</td>
                    <td>
                      <span className={r.base ? "tag" : "tag o"}>{r.base ? "Base" : "Custom"}</span>
                    </td>
                    <td>{r.perms.length}</td>
                    <td>{memberCount(r.id)}</td>
                    <td style={{ color: "#a9b3c2" }}>⋮</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <LegacyHelpPanel topicKey="roles" />
      </div>

      {editingRole && (
        <RoleDrawer
          role={editingRole}
          roles={roles}
          members={editingId !== "new" ? (data?.people ?? []).filter((p) => p.roles.includes(editingId as string)) : []}
          saving={saveMutation.isPending}
          onClose={() => setEditingId(null)}
          onSave={(value) => saveMutation.mutate(value)}
          onRemoveMember={(userId) => {
            if (editingId !== "new") removeMemberMutation.mutate({ userId, roleId: editingId as string });
          }}
          {...(editingId !== "new"
            ? { onDelete: () => deleteMutation.mutate({ id: editingId as string, name: editingRole.name }) }
            : {})}
          {...("id" in editingRole ? { onCopy: () => copyMutation.mutate(editingRole) } : {})}
        />
      )}
    </>
  );
}

function RoleDrawer({
  role,
  roles,
  members,
  saving,
  onClose,
  onSave,
  onDelete,
  onCopy,
  onRemoveMember,
}: {
  role: DraftRole;
  roles: Role[];
  members: Person[];
  saving: boolean;
  onClose: () => void;
  onSave: (value: DraftRole) => void;
  onDelete?: () => void;
  onCopy?: () => void;
  onRemoveMember: (userId: string) => void;
}) {
  const [draft, setDraft] = useState(role);
  const [errors, setErrors] = useState<string[]>([]);
  const isBase = "base" in draft && draft.base;

  function togglePerm(perm: string) {
    setDraft((d) => ({
      ...d,
      perms: d.perms.includes(perm) ? d.perms.filter((p) => p !== perm) : [...d.perms, perm],
    }));
  }

  function setAll(domain: string, on: boolean) {
    const domainPerms = (PERMISSION_DOMAINS[domain] ?? []).map((a) => `${domain}:${a}`);
    setDraft((d) => ({
      ...d,
      perms: on ? Array.from(new Set([...d.perms, ...domainPerms])) : d.perms.filter((p) => !domainPerms.includes(p)),
    }));
  }

  const allPerms = Object.entries(PERMISSION_DOMAINS).flatMap(([domain, actions]) => actions.map((a) => `${domain}:${a}`));
  function setAllPerms(on: boolean) {
    setDraft((d) => ({ ...d, perms: on ? [...allPerms] : [] }));
  }

  function validate(): string[] {
    const errs: string[] = [];
    const name = draft.name.trim();
    if (name.length < 2) errs.push("Role name is required.");
    const existingId = "id" in draft ? draft.id : undefined;
    if (roles.some((r) => r.name.toLowerCase() === name.toLowerCase() && r.id !== existingId)) {
      errs.push("A role with this name already exists.");
    }
    if (draft.perms.length === 0) errs.push("Select at least one permission.");
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
      <div id="drw" style={{ width: 560 }}>
        <div className="dh">
          <h2>
            {"id" in draft ? `Edit — ${draft.name}` : "Add Role"}
            {isBase && (
              <span className="tag" style={{ marginLeft: 6 }}>
                Base
              </span>
            )}
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
          <div className="sect">Role</div>
          <div className="fld">
            <label>Name *</label>
            <input
              value={draft.name}
              disabled={isBase}
              onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
            />
          </div>
          <div className="fld">
            <label>Description</label>
            <input value={draft.desc} onChange={(e) => setDraft((d) => ({ ...d, desc: e.target.value }))} />
          </div>

          <div className="sect-row">
            <div className="sect">Permissions (domain : entity : action)</div>
            <span style={{ fontSize: 11.5, color: "#8794a8" }}>
              {draft.perms.length} / {allPerms.length} selected
            </span>
            <div className="permseg lg">
              <button type="button" onClick={() => setAllPerms(true)}>Select all</button>
              <button type="button" onClick={() => setAllPerms(false)}>Clear all</button>
            </div>
          </div>
          {Object.entries(PERMISSION_DOMAINS).map(([domain, actions]) => {
            const domainPerms = actions.map((a) => `${domain}:${a}`);
            return (
              <div key={domain} style={{ marginBottom: 10 }}>
                <div className="perm-domain-hd">
                  <b style={{ fontSize: 12, color: "#152550" }}>{domain}</b>
                  <div className="permseg">
                    <button type="button" onClick={() => setAll(domain, true)}>All</button>
                    <button type="button" onClick={() => setAll(domain, false)}>None</button>
                  </div>
                </div>
                <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 4 }}>
                  {actions.map((action) => {
                    const perm = `${domain}:${action}`;
                    return (
                      <label key={perm} style={{ fontSize: 12, fontFamily: "monospace" }}>
                        <input
                          type="checkbox"
                          checked={draft.perms.includes(perm)}
                          onChange={() => togglePerm(perm)}
                          style={{ width: "auto", marginRight: 4 }}
                        />
                        {action}
                      </label>
                    );
                  })}
                </div>
                {domainPerms.length === 0 && null}
              </div>
            );
          })}

          {"id" in draft && (
            <>
              <div className="sect">Members ({members.length})</div>
              {members.length === 0 && <div style={{ fontSize: 12.5, color: "#8794a8" }}>No members in this role.</div>}
              {members.map((m) => (
                <div key={m.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, padding: "4px 0" }}>
                  <span>{m.name}</span>
                  <span className="lnk" style={{ cursor: "pointer", color: "#b3261e" }} onClick={() => onRemoveMember(m.id)}>
                    remove
                  </span>
                </div>
              ))}
            </>
          )}

          {"id" in draft && !draft.base && onDelete && (
            <div className="fld" style={{ marginTop: 14 }}>
              <LegacyBtn
                secondary
                onClick={() => {
                  const warning = members.length
                    ? ` It is assigned to ${members.length} user(s); the assignment will be removed.`
                    : "";
                  if (window.confirm(`Delete role "${draft.name}"?${warning}`)) onDelete();
                }}
              >
                Delete role
              </LegacyBtn>
            </div>
          )}
          {"id" in draft && onCopy && (
            <div className="fld">
              <LegacyBtn secondary onClick={onCopy}>Copy as new role</LegacyBtn>
            </div>
          )}
        </div>
        <div className="df">
          <LegacyBtn secondary onClick={onClose} disabled={saving}>Cancel</LegacyBtn>
          <LegacyBtn onClick={handleSave} disabled={saving}>
            {saving ? "Saving…" : "id" in draft ? "Save changes" : "Create role"}
          </LegacyBtn>
        </div>
      </div>
    </>
  );
}
