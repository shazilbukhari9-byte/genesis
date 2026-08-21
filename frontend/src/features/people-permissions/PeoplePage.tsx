import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { LegacyBtn } from "../shared/LegacyBtn";
import { LegacyHelpPanel } from "../shared/LegacyHelpPanel";
import {
  bulkImportPeopleCsv,
  bulkUpdatePeople,
  deletePerson,
  exportAllDirectoryData,
  fetchDirectory,
  importAllDirectoryData,
  resetDemoData,
  upsertPerson,
} from "./store";
import type { Person } from "./types";

const QUERY_KEY = ["people-directory"];
const SAMPLE_CSV =
  "name,email,title,department,division,license,skills\nAnna Lee,alee@mcmgroup.com,Advisor,Customer Care,HQ (London),CX 2,Billing:4\nTom Ford,tford@mcmgroup.com,Advisor,Customer Care,HQ (London),CX 1,Technical Support:3\nNina Gupta,ngupta@mcmgroup.com,Team Leader,Digital,Mumbai Hub,CX 3,";

type SortKey = "name" | "email" | "division" | "license" | "state";

function goToAdminIndex(): void {
  const win = window as unknown as { adminIndex?: () => void; __hidePeople?: () => void };
  win.__hidePeople?.();
  win.adminIndex?.();
}

function emptyPerson(employeeRoleId?: string): Omit<Person, "id" | "created"> {
  return {
    name: "",
    email: "",
    title: "",
    dept: "",
    division: "d_home",
    roles: employeeRoleId ? [employeeRoleId] : [],
    license: "CX 2",
    skills: {},
    langs: [],
    station: "WebRTC softphone",
    state: "Pending invite",
    ext: "",
  };
}

export function PeoplePage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [divFilter, setDivFilter] = useState("");
  const [stateFilter, setStateFilter] = useState("");
  const [licFilter, setLicFilter] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 } | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [editing, setEditing] = useState<Person | Omit<Person, "id" | "created"> | null>(null);
  const [showCsvImport, setShowCsvImport] = useState(false);
  const [showDataMenu, setShowDataMenu] = useState(false);

  const { data, isLoading } = useQuery({ queryKey: QUERY_KEY, queryFn: fetchDirectory });

  const saveMutation = useMutation({
    mutationFn: upsertPerson,
    onSuccess: (updated) => {
      queryClient.setQueryData(QUERY_KEY, updated);
      setEditing(null);
    },
  });
  const deleteMutation = useMutation({
    mutationFn: deletePerson,
    onSuccess: (updated) => queryClient.setQueryData(QUERY_KEY, updated),
  });
  const bulkMutation = useMutation({
    mutationFn: ({ ids, action }: { ids: string[]; action: "activate" | "deactivate" | "invite" | "delete" }) =>
      bulkUpdatePeople(ids, action === "invite" ? "activate" : action),
    onSuccess: (updated) => {
      queryClient.setQueryData(QUERY_KEY, updated);
      setSelected([]);
    },
  });
  const resetMutation = useMutation({
    mutationFn: resetDemoData,
    onSuccess: (updated) => {
      queryClient.setQueryData(QUERY_KEY, updated);
      setShowDataMenu(false);
    },
  });

  const people = data?.people ?? [];
  const divisionName = (id: string) => data?.divisions.find((d) => d.id === id)?.name ?? id;
  const roleNames = (ids: string[]) =>
    ids.map((id) => data?.roles.find((r) => r.id === id)?.name).filter(Boolean).join(", ") || "Employee";
  const employeeRoleId = data?.roles.find((r) => r.name === "Employee")?.id;

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    let list = people.filter((p) => {
      if (q && !`${p.name} ${p.email} ${p.title} ${p.dept}`.toLowerCase().includes(q)) return false;
      if (divFilter && p.division !== divFilter) return false;
      if (stateFilter && p.state !== stateFilter) return false;
      if (licFilter && p.license !== licFilter) return false;
      return true;
    });
    if (sort) {
      const get = (p: Person) => {
        const v =
          sort.key === "name" ? p.name : sort.key === "email" ? p.email : sort.key === "division" ? divisionName(p.division) : sort.key === "license" ? p.license : p.state;
        return v.toLowerCase();
      };
      list = [...list].sort((a, b) => (get(a) < get(b) ? -1 : get(a) > get(b) ? 1 : 0) * sort.dir);
    }
    return list;
  }, [people, search, divFilter, stateFilter, licFilter, sort, data]);

  function toggleSelected(id: string) {
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  }

  function toggleSort(key: SortKey) {
    setSort((s) => (s?.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: 1 }));
  }

  function sortArrow(key: SortKey) {
    if (sort?.key !== key) return " ⇅";
    return sort.dir === 1 ? " ▲" : " ▼";
  }

  function handleExportCsv() {
    const escapeCell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    const lines = ["Name,Email,Division,Licence,Roles,Status"].concat(
      filtered.map((p) =>
        [p.name, p.email, divisionName(p.division), p.license, roleNames(p.roles), p.state].map(escapeCell).join(","),
      ),
    );
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "people.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function handleExportJson() {
    const all = await exportAllDirectoryData();
    const blob = new Blob([JSON.stringify(all, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "people-permissions-data.json";
    a.click();
    URL.revokeObjectURL(a.href);
    queryClient.setQueryData(QUERY_KEY, all);
    setShowDataMenu(false);
  }

  function handleImportJson() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/json";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      const text = await file.text();
      const updated = await importAllDirectoryData(text);
      queryClient.setQueryData(QUERY_KEY, updated);
      setShowDataMenu(false);
    };
    input.click();
  }

  return (
    <>
      <div className="phd">
        <div className="bc">
          <a onClick={goToAdminIndex}>Admin</a> › People &amp; Permissions
        </div>
        <div className="tt">
          <h1>People</h1>
          <div className="rt" style={{ position: "relative" }}>
            <LegacyBtn onClick={() => setEditing(emptyPerson(employeeRoleId))}>+ Add Person</LegacyBtn>
            <LegacyBtn secondary onClick={() => setShowCsvImport(true)}>
              Bulk Import
            </LegacyBtn>
            <LegacyBtn secondary onClick={handleExportCsv}>
              Export CSV
            </LegacyBtn>
            <LegacyBtn secondary onClick={() => setShowDataMenu((s) => !s)}>
              Data ▾
            </LegacyBtn>
            {showDataMenu && (
              <div
                style={{
                  position: "absolute",
                  right: 0,
                  top: 40,
                  background: "#fff",
                  border: "1px solid #ccd4e0",
                  borderRadius: 6,
                  boxShadow: "0 8px 30px rgba(0,0,0,.15)",
                  zIndex: 60,
                  minWidth: 190,
                }}
              >
                <div className="ddi" style={{ padding: "9px 14px", cursor: "pointer", fontSize: 12.5 }} onClick={handleExportJson}>
                  Export all data (JSON)
                </div>
                <div className="ddi" style={{ padding: "9px 14px", cursor: "pointer", fontSize: 12.5 }} onClick={handleImportJson}>
                  Import data (JSON)
                </div>
                <div
                  className="ddi"
                  style={{ padding: "9px 14px", cursor: "pointer", fontSize: 12.5 }}
                  onClick={() => {
                    setShowDataMenu(false);
                    (window as unknown as { openPage?: (id: string) => void }).openPage?.("auditlog");
                  }}
                >
                  View audit log
                </div>
                <div
                  className="ddi"
                  style={{ padding: "9px 14px", cursor: "pointer", fontSize: 12.5, color: "#c9401a" }}
                  onClick={() => resetMutation.mutate()}
                >
                  Reset demo data
                </div>
              </div>
            )}
          </div>
        </div>
        <div className="tabs">
          <div className="tb on">All People</div>
        </div>
      </div>

      <div className="pbody">
        {selected.length > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, background: "#fff7f4", border: "1px solid #ffd9cc", borderRadius: 6, padding: "7px 12px", margin: "0 0 10px" }}>
            <b style={{ fontSize: 12.5 }}>{selected.length} selected</b>
            <LegacyBtn secondary style={{ height: 28 }} onClick={() => bulkMutation.mutate({ ids: selected, action: "activate" })}>
              Activate
            </LegacyBtn>
            <LegacyBtn secondary style={{ height: 28 }} onClick={() => bulkMutation.mutate({ ids: selected, action: "deactivate" })}>
              Deactivate
            </LegacyBtn>
            <LegacyBtn secondary style={{ height: 28 }} onClick={() => bulkMutation.mutate({ ids: selected, action: "invite" })}>
              Send invite
            </LegacyBtn>
            <LegacyBtn style={{ height: 28 }} onClick={() => bulkMutation.mutate({ ids: selected, action: "delete" })}>
              Delete
            </LegacyBtn>
          </div>
        )}

        <div className="tbar">
          <input
            className="s"
            placeholder="Search name, email, title, department"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select className="chip" style={{ cursor: "pointer" }} value={divFilter} onChange={(e) => setDivFilter(e.target.value)}>
            <option value="">Division: All</option>
            {(data?.divisions ?? []).map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
          <select className="chip" style={{ cursor: "pointer" }} value={stateFilter} onChange={(e) => setStateFilter(e.target.value)}>
            <option value="">Status: Any</option>
            <option>Active</option>
            <option>Pending invite</option>
            <option>Inactive</option>
          </select>
          <select className="chip" style={{ cursor: "pointer" }} value={licFilter} onChange={(e) => setLicFilter(e.target.value)}>
            <option value="">Licence: All</option>
            {Object.keys(data?.licenses ?? {}).map((l) => (
              <option key={l}>{l}</option>
            ))}
          </select>
          <div className="sp" />
          <div className="chip" style={{ cursor: "pointer" }} onClick={() => queryClient.invalidateQueries({ queryKey: QUERY_KEY })}>
            ↻ Refresh
          </div>
        </div>

        <div className="tblw">
          <table className="dt">
            <thead>
              <tr>
                <th style={{ width: 34 }}>
                  <input
                    type="checkbox"
                    checked={filtered.length > 0 && selected.length === filtered.length}
                    onChange={(e) => setSelected(e.target.checked ? filtered.map((p) => p.id) : [])}
                  />
                </th>
                <th className="lnk" style={{ cursor: "pointer" }} onClick={() => toggleSort("name")}>Name{sortArrow("name")}</th>
                <th className="lnk" style={{ cursor: "pointer" }} onClick={() => toggleSort("email")}>Email{sortArrow("email")}</th>
                <th className="lnk" style={{ cursor: "pointer" }} onClick={() => toggleSort("division")}>Division{sortArrow("division")}</th>
                <th className="lnk" style={{ cursor: "pointer" }} onClick={() => toggleSort("license")}>Licence{sortArrow("license")}</th>
                <th>Roles</th>
                <th>Skills</th>
                <th className="lnk" style={{ cursor: "pointer" }} onClick={() => toggleSort("state")}>Status{sortArrow("state")}</th>
                <th style={{ width: 30 }}></th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={9} style={{ color: "#8794a8", padding: 18 }}>Loading…</td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={9} style={{ textAlign: "center", color: "#8794a8", padding: 26 }}>
                    No people match the current filters
                  </td>
                </tr>
              ) : (
                filtered.map((p) => {
                  const skillCount = Object.keys(p.skills || {}).length;
                  return (
                    <tr key={p.id} onClick={() => setEditing(p)} style={{ cursor: "pointer" }}>
                      <td onClick={(e) => e.stopPropagation()}>
                        <input type="checkbox" checked={selected.includes(p.id)} onChange={() => toggleSelected(p.id)} />
                      </td>
                      <td>
                        <b className="lnk">{p.name}</b>
                        <br />
                        <span style={{ color: "#8794a8", fontSize: 11 }}>{p.title}</span>
                      </td>
                      <td>{p.email}</td>
                      <td>{divisionName(p.division)}</td>
                      <td>
                        <span className="tag o">{p.license}</span>
                      </td>
                      <td style={{ maxWidth: 180 }}>{roleNames(p.roles)}</td>
                      <td>{skillCount ? `${skillCount} skill${skillCount > 1 ? "s" : ""}` : "—"}</td>
                      <td>
                        <span className={"st" + (p.state === "Active" ? " ok" : "")}>
                          <span className="d" style={p.state !== "Active" ? { background: "#8a94a6" } : undefined}></span>
                          {p.state}
                        </span>
                      </td>
                      <td style={{ color: "#a9b3c2" }}>⋮</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
          <div className="pgr">
            <span>
              Showing <b>{filtered.length}</b> of <b>{people.length}</b> people
            </span>
            <div className="sp" />
            <span>
              {people.filter((p) => p.state === "Active").length} active ·{" "}
              {people.filter((p) => p.state === "Pending invite").length} pending ·{" "}
              {people.filter((p) => p.state === "Inactive").length} inactive
            </span>
          </div>
        </div>

        <LegacyHelpPanel topicKey="people" />
      </div>

      {editing && (
        <PersonDrawer
          person={editing}
          people={people}
          divisions={data?.divisions ?? []}
          roles={data?.roles ?? []}
          licenses={Object.keys(data?.licenses ?? {})}
          skills={data?.skills ?? []}
          langs={data?.langs ?? []}
          saving={saveMutation.isPending}
          onClose={() => setEditing(null)}
          onSave={(value) => saveMutation.mutate(value)}
          {...("id" in editing ? { onDelete: () => deleteMutation.mutate((editing as Person).id) } : {})}
        />
      )}

      {showCsvImport && <CsvImportDrawer onClose={() => setShowCsvImport(false)} onImported={(updated) => queryClient.setQueryData(QUERY_KEY, updated)} />}
    </>
  );
}

function CsvImportDrawer({ onClose, onImported }: { onClose: () => void; onImported: (data: unknown) => void }) {
  const [csv, setCsv] = useState("");
  const [result, setResult] = useState<{ imported: number; errors: string[] } | null>(null);
  const [importing, setImporting] = useState(false);

  async function run() {
    setImporting(true);
    const { data, imported, errors } = await bulkImportPeopleCsv(csv);
    setResult({ imported, errors });
    setImporting(false);
    onImported(data);
  }

  return (
    <>
      <div id="scrim" onClick={onClose} />
      <div id="drw">
        <div className="dh">
          <h2>Bulk Import People</h2>
          <div className="x" onClick={onClose}>×</div>
        </div>
        <div className="db">
          <div className="sect">Paste CSV</div>
          <div style={{ fontSize: 12, color: "#5b6b82", marginBottom: 8, lineHeight: 1.6 }}>
            Columns: <code>name,email,title,department,division,license,skills</code>
            <br />
            Skills use <code>Skill:proficiency</code> separated by <code>;</code> — e.g. <code>Billing:5;Sales:3</code>. Name
            and email are mandatory. Unknown divisions fall back to Home.
          </div>
          <div className="fld">
            <textarea
              value={csv}
              onChange={(e) => setCsv(e.target.value)}
              style={{ height: 170, fontFamily: "monospace", fontSize: 12, width: "100%" }}
              placeholder={"name,email,title,department,division,license,skills\nAnna Lee,alee@mcmgroup.com,Advisor,Customer Care,HQ (London),CX 2,Billing:4"}
            />
          </div>
          <div className="fld">
            <label>&nbsp;</label>
            <LegacyBtn secondary onClick={() => setCsv(SAMPLE_CSV)}>
              Load sample
            </LegacyBtn>
          </div>
          {result && (
            <div style={{ fontSize: 12.5, color: "#33425c" }}>
              Imported {result.imported} people.
              {result.errors.length > 0 && (
                <ul>
                  {result.errors.map((e, i) => (
                    <li key={i}>{e}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
        <div className="df">
          <LegacyBtn secondary onClick={onClose}>Cancel</LegacyBtn>
          <LegacyBtn onClick={run} disabled={!csv.trim() || importing}>
            {importing ? "Importing…" : "Import"}
          </LegacyBtn>
        </div>
      </div>
    </>
  );
}

const STATIONS = ["WebRTC softphone", "Physical phone", "Remote station"];
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function PersonDrawer({
  person,
  people,
  divisions,
  roles,
  licenses,
  skills,
  langs,
  saving,
  onClose,
  onSave,
  onDelete,
}: {
  person: Person | Omit<Person, "id" | "created">;
  people: Person[];
  divisions: { id: string; name: string }[];
  roles: { id: string; name: string; desc: string; perms: string[] }[];
  licenses: string[];
  skills: { id: string; name: string }[];
  langs: { id: string; name: string }[];
  saving: boolean;
  onClose: () => void;
  onSave: (value: Person | Omit<Person, "id" | "created">) => void;
  onDelete?: () => void;
}) {
  const [draft, setDraft] = useState(person);
  const [errors, setErrors] = useState<string[]>([]);
  const isNew = !("id" in draft);
  const existingId = "id" in draft ? draft.id : undefined;

  function set<K extends keyof typeof draft>(key: K, value: (typeof draft)[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  function setSkill(name: string, proficiency: number) {
    setDraft((d) => {
      const next = { ...d.skills };
      if (proficiency > 0) next[name] = proficiency;
      else delete next[name];
      return { ...d, skills: next };
    });
  }

  function toggleLang(name: string, on: boolean) {
    set("langs", on ? [...draft.langs, name] : draft.langs.filter((l) => l !== name));
  }

  function validate(): string[] {
    const errs: string[] = [];
    if (draft.name.trim().length < 2) errs.push("Full name is required.");
    const email = draft.email.trim().toLowerCase();
    if (!EMAIL_RE.test(email)) errs.push("A valid email address is required.");
    const dup = people.find((p) => p.email.toLowerCase() === email && p.id !== existingId);
    if (dup) errs.push(`Email is already used by ${dup.name}.`);
    return errs;
  }

  function handleSave() {
    const errs = validate();
    if (errs.length) {
      setErrors(errs);
      return;
    }
    onSave({ ...draft, name: draft.name.trim(), email: draft.email.trim().toLowerCase() });
  }

  function handleSendInvite() {
    onSave({ ...draft, state: "Pending invite" });
  }

  return (
    <>
      <div id="scrim" onClick={onClose} />
      <div id="drw">
        <div className="dh">
          <h2>{isNew ? "Add Person" : `Edit — ${draft.name}`}</h2>
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

          <div className="sect">Identity</div>
          <div className="fld">
            <label>Full name *</label>
            <input value={draft.name} onChange={(e) => set("name", e.target.value)} />
          </div>
          <div className="fld">
            <label>Email *</label>
            <input value={draft.email} onChange={(e) => set("email", e.target.value)} />
          </div>
          <div className="fld">
            <label>Title</label>
            <input value={draft.title} onChange={(e) => set("title", e.target.value)} />
          </div>
          <div className="fld">
            <label>Department</label>
            <input value={draft.dept} onChange={(e) => set("dept", e.target.value)} />
          </div>

          <div className="sect">Access</div>
          <div className="fld">
            <label>Licence</label>
            <select value={draft.license} onChange={(e) => set("license", e.target.value)}>
              {licenses.map((l) => (
                <option key={l}>{l}</option>
              ))}
            </select>
          </div>
          <div className="fld">
            <label>Home division</label>
            <select value={draft.division} onChange={(e) => set("division", e.target.value)}>
              {divisions.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          </div>
          <div className="fld">
            <label>Roles</label>
            {roles.map((r) => {
              const isEmployee = r.name === "Employee";
              return (
                <div className="tgl" key={r.id}>
                  <input
                    type="checkbox"
                    checked={draft.roles.includes(r.id)}
                    disabled={isEmployee}
                    onChange={(e) =>
                      set("roles", e.target.checked ? [...draft.roles, r.id] : draft.roles.filter((x) => x !== r.id))
                    }
                    style={{ width: "auto" }}
                  />
                  {r.name}
                  <span style={{ color: "#8794a8", fontSize: 11, marginLeft: 6 }}>{r.perms.length} perms</span>
                </div>
              );
            })}
          </div>

          <div className="sect">Contact Centre</div>
          <div className="fld">
            <label>ACD skills &amp; proficiency</label>
            {skills.map((s) => (
              <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "3px 0" }}>
                <span style={{ flex: 1, fontSize: 12.5 }}>{s.name}</span>
                <select
                  style={{ width: 130, height: 28, border: "1px solid #ccd4e0", borderRadius: 4 }}
                  value={draft.skills[s.name] ?? 0}
                  onChange={(e) => setSkill(s.name, Number(e.target.value))}
                >
                  {[0, 1, 2, 3, 4, 5].map((n) => (
                    <option key={n} value={n}>{n === 0 ? "Not assigned" : `Proficiency ${n}`}</option>
                  ))}
                </select>
              </div>
            ))}
          </div>
          <div className="fld">
            <label>Languages</label>
            <div>
              {langs.map((l) => (
                <label key={l.id} style={{ display: "inline-flex", alignItems: "center", gap: 5, margin: "0 12px 6px 0", fontSize: 12.5 }}>
                  <input
                    type="checkbox"
                    checked={draft.langs.includes(l.name)}
                    onChange={(e) => toggleLang(l.name, e.target.checked)}
                    style={{ width: "auto" }}
                  />
                  {l.name}
                </label>
              ))}
            </div>
          </div>
          <div className="fld">
            <label>Station type</label>
            <select value={draft.station} onChange={(e) => set("station", e.target.value)}>
              {STATIONS.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </div>

          {!isNew && (
            <>
              <div className="sect">Account</div>
              <div className="fld">
                <label>Status</label>
                <select value={draft.state} onChange={(e) => set("state", e.target.value as Person["state"])}>
                  <option>Active</option>
                  <option>Pending invite</option>
                  <option>Inactive</option>
                </select>
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 4, flexWrap: "wrap" }}>
                {draft.state !== "Active" && (
                  <LegacyBtn secondary onClick={handleSendInvite} disabled={saving}>
                    Send invite
                  </LegacyBtn>
                )}
                <LegacyBtn
                  secondary
                  onClick={() => (window as unknown as { toast?: (m: string) => void }).toast?.(`Password reset email sent to ${draft.email}`)}
                >
                  Reset password
                </LegacyBtn>
                {onDelete && (
                  <LegacyBtn
                    style={{ background: "transparent", color: "#c9401a" }}
                    onClick={() => {
                      onDelete();
                      onClose();
                    }}
                  >
                    Delete person
                  </LegacyBtn>
                )}
              </div>
            </>
          )}
        </div>
        <div className="df">
          <LegacyBtn secondary onClick={onClose} disabled={saving}>Cancel</LegacyBtn>
          <LegacyBtn onClick={handleSave} disabled={saving}>
            {saving ? "Saving…" : isNew ? "Create & invite" : "Save changes"}
          </LegacyBtn>
        </div>
      </div>
    </>
  );
}
