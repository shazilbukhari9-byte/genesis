import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { LegacyBtn } from "../shared/LegacyBtn";
import { LegacyHelpPanel } from "../shared/LegacyHelpPanel";
import { toast } from "../shared/toast";
import { fetchOrgSettings, updateOrgSetting, updateOrgSettingsBulk } from "./orgSettingsService";
import { ORG_SETTINGS_CATEGORIES, validateSettingValue, type OrgSetting, type OrgSettingsCategory } from "./types";

const QUERY_KEY = ["org-settings"];

function currentUserName(): string {
  const app = (window as unknown as { APP?: { user?: { name?: string } } }).APP;
  return app?.user?.name ?? "Admin";
}

function goToAdminIndex(): void {
  const win = window as unknown as { adminIndex?: () => void; __hideOrgSettings?: () => void };
  win.__hideOrgSettings?.();
  win.adminIndex?.();
}

function SettingField({
  setting,
  value,
  onChange,
}: {
  setting: OrgSetting;
  value: OrgSetting["value"];
  onChange: (value: OrgSetting["value"]) => void;
}) {
  if (setting.type === "toggle") {
    return (
      <div className="tgl">
        <input type="checkbox" checked={Boolean(value)} onChange={(e) => onChange(e.target.checked)} style={{ width: "auto", marginRight: 6 }} />
        Enabled
      </div>
    );
  }
  if (setting.type === "select") {
    return (
      <select value={String(value)} onChange={(e) => onChange(e.target.value)}>
        {setting.options?.map((opt) => (
          <option key={opt}>{opt}</option>
        ))}
      </select>
    );
  }
  return (
    <input
      type={setting.type === "number" ? "number" : "text"}
      value={String(value)}
      onChange={(e) => onChange(setting.type === "number" ? Number(e.target.value) : e.target.value)}
    />
  );
}

function EditDrawer({
  setting,
  onClose,
  onSave,
  saving,
}: {
  setting: OrgSetting;
  onClose: () => void;
  onSave: (value: OrgSetting["value"]) => void;
  saving: boolean;
}) {
  const [draft, setDraft] = useState<OrgSetting["value"]>(setting.value);
  const locked = setting.type === "locked";
  const error = locked ? null : validateSettingValue(setting, draft);

  return (
    <>
      <div id="scrim" onClick={onClose} />
      <div id="drw" style={{ height: "auto", top: "26%", bottom: "auto", borderRadius: "8px 0 0 8px" }}>
        <div className="dh">
          <h2>{setting.key}</h2>
          <div className="x" onClick={onClose}>
            ×
          </div>
        </div>
        <div className="db">
          {setting.hint && (
            <div style={{ fontSize: 12, color: "#5b6b82", margin: "0 0 10px", lineHeight: 1.6 }}>{setting.hint}</div>
          )}
          <div className="fld">
            <label>{setting.key}</label>
            {/* Locked settings are excluded from the row click-to-edit path (see the
                table below) and from the bulk drawer, so this only renders if
                something else ever routes here — read-only, no way to submit a change. */}
            {locked ? (
              <div style={{ fontSize: 13, color: "#3d4a5c", padding: "4px 0" }}>{String(setting.value)}</div>
            ) : (
              <SettingField setting={setting} value={draft} onChange={setDraft} />
            )}
            {error && <div style={{ color: "#b3261e", fontSize: 12, marginTop: 4 }}>{error}</div>}
          </div>
        </div>
        <div className="df">
          <LegacyBtn secondary onClick={onClose} disabled={saving}>
            {locked ? "Close" : "Cancel"}
          </LegacyBtn>
          {!locked && (
            <LegacyBtn onClick={() => onSave(draft)} disabled={saving || Boolean(error)}>
              {saving ? "Saving…" : "Save changes"}
            </LegacyBtn>
          )}
        </div>
      </div>
    </>
  );
}

// The "+ Edit <category> Settings" button used to just open the category's
// very first row regardless of what it was — on Data Residency that's the
// locked "Core region" field, opening an editor with no input and an
// enabled Save button for a value that's supposed to be immutable. This is
// what that button actually should have meant: edit every editable setting
// in the category at once. Locked settings aren't listed here at all —
// same as the table's row click, which already skips them.
function BulkEditDrawer({
  categoryLabel,
  settings,
  onClose,
  onSave,
  saving,
}: {
  categoryLabel: string;
  settings: OrgSetting[];
  onClose: () => void;
  onSave: (updates: { index: number; value: OrgSetting["value"] }[]) => void;
  saving: boolean;
}) {
  const editable = useMemo(() => settings.map((s, index) => ({ s, index })).filter((e) => e.s.type !== "locked"), [settings]);
  const [drafts, setDrafts] = useState<Record<number, OrgSetting["value"]>>(
    () => Object.fromEntries(editable.map((e) => [e.index, e.s.value])),
  );

  const errors = useMemo(
    () => Object.fromEntries(editable.map((e) => [e.index, validateSettingValue(e.s, drafts[e.index] ?? e.s.value)])),
    [editable, drafts],
  );
  const hasErrors = Object.values(errors).some(Boolean);

  function handleSave() {
    const updates = editable
      .filter((e) => (drafts[e.index] ?? e.s.value) !== e.s.value)
      .map((e) => ({ index: e.index, value: drafts[e.index] ?? e.s.value }));
    if (updates.length === 0) {
      onClose();
      return;
    }
    onSave(updates);
  }

  return (
    <>
      <div id="scrim" onClick={onClose} />
      <div id="drw">
        <div className="dh">
          <h2>Edit {categoryLabel} Settings</h2>
          <div className="x" onClick={onClose}>
            ×
          </div>
        </div>
        <div className="db">
          {editable.length === 0 ? (
            <div style={{ fontSize: 12.5, color: "#8794a8" }}>Every setting in this category is locked.</div>
          ) : (
            editable.map(({ s, index }) => (
              <div className="fld" key={s.key}>
                <label>{s.key}</label>
                {s.hint && <div style={{ fontSize: 11, color: "#8794a8", marginBottom: 4 }}>{s.hint}</div>}
                <SettingField setting={s} value={drafts[index] ?? s.value} onChange={(v) => setDrafts((d) => ({ ...d, [index]: v }))} />
                {errors[index] && <div style={{ color: "#b3261e", fontSize: 12, marginTop: 4 }}>{errors[index]}</div>}
              </div>
            ))
          )}
        </div>
        <div className="df">
          <LegacyBtn secondary onClick={onClose} disabled={saving}>
            Cancel
          </LegacyBtn>
          <LegacyBtn onClick={handleSave} disabled={saving || editable.length === 0 || hasErrors}>
            {saving ? "Saving…" : "Save changes"}
          </LegacyBtn>
        </div>
      </div>
    </>
  );
}

export function OrganizationSettingsPage() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<OrgSettingsCategory>("general");
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [bulkEditing, setBulkEditing] = useState(false);
  const [search, setSearch] = useState("");

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: QUERY_KEY,
    queryFn: fetchOrgSettings,
  });

  const mutation = useMutation({
    mutationFn: ({ index, value }: { index: number; value: OrgSetting["value"] }) =>
      updateOrgSetting(activeTab, index, value, currentUserName()),
    onSuccess: (updated, { index }) => {
      queryClient.setQueryData(QUERY_KEY, updated);
      toast(`Saved — <b>${updated[activeTab][index]?.key}</b>`);
      setEditingIndex(null);
    },
    onError: () => toast("Couldn't save changes — try again."),
  });

  const bulkMutation = useMutation({
    mutationFn: (updates: { index: number; value: OrgSetting["value"] }[]) =>
      updateOrgSettingsBulk(activeTab, updates, currentUserName()),
    onSuccess: (updated, updates) => {
      queryClient.setQueryData(QUERY_KEY, updated);
      toast(`${updates.length} setting${updates.length === 1 ? "" : "s"} saved`);
      setBulkEditing(false);
    },
    onError: () => toast("Couldn't save changes — try again."),
  });

  const rows = data?.[activeTab] ?? [];
  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((s) => s.key.toLowerCase().includes(q) || String(s.value).toLowerCase().includes(q));
  }, [rows, search]);
  const editingSetting = editingIndex !== null ? (rows[editingIndex] ?? null) : null;
  const activeLabel = ORG_SETTINGS_CATEGORIES.find((c) => c.id === activeTab)?.label ?? "";

  function handleExport() {
    if (!data) return;
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "organization-settings.json";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <div className="phd">
        <div className="bc">
          <a onClick={goToAdminIndex}>Admin</a> › Account Settings
        </div>
        <div className="tt">
          <h1>Organization Settings</h1>
          <div className="rt">
            <LegacyBtn disabled={!rows.length} onClick={() => rows.length && setBulkEditing(true)}>
              + Edit {activeLabel} Settings
            </LegacyBtn>
            <LegacyBtn secondary onClick={handleExport} disabled={!data}>
              Export
            </LegacyBtn>
          </div>
        </div>
        <div className="tabs">
          {ORG_SETTINGS_CATEGORIES.map((cat) => (
            <div
              key={cat.id}
              className={"tb" + (activeTab === cat.id ? " on" : "")}
              style={{ cursor: "pointer" }}
              onClick={() => {
                setActiveTab(cat.id);
                setSearch("");
              }}
            >
              {cat.label}
            </div>
          ))}
        </div>
      </div>

      <div className="pbody">
        <div className="tbar">
          <input
            className="s"
            placeholder={`Search ${activeLabel.toLowerCase()} settings`}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="chip">Division: All ▾</div>
          <div className="chip">Status: Any ▾</div>
          <div className="sp" />
          <div className="chip">⚙ Columns</div>
          <div className="chip" style={{ cursor: "pointer" }} onClick={() => queryClient.invalidateQueries({ queryKey: QUERY_KEY })}>
            ↻ Refresh
          </div>
        </div>

        {activeTab === "residency" && (
          <div style={{ fontSize: 12, color: "#5b6b82", margin: "0 0 10px", lineHeight: 1.6 }}>
            Data residency is fixed at org creation for compliance. Media region is the only adjustable value — it
            affects where RTP is anchored, not where data is stored.
          </div>
        )}
        {activeTab === "beta" && (
          <div style={{ fontSize: 12, color: "#5b6b82", margin: "0 0 10px", lineHeight: 1.6 }}>
            Beta features release "dark" and are enabled per-org here. They may change or be withdrawn; not covered
            by SLA.
          </div>
        )}

        <div className="tblw">
          <table className="dt">
            <thead>
              <tr>
                <th>Setting</th>
                <th>Value</th>
                <th></th>
                <th>Last changed</th>
                <th style={{ width: 40 }}></th>
              </tr>
            </thead>
            <tbody>
              {isError ? (
                <tr>
                  <td colSpan={5} style={{ color: "#b3261e", padding: 18, textAlign: "center" }}>
                    Couldn't load organization settings.{" "}
                    <a onClick={() => refetch()} className="lnk">
                      Retry
                    </a>
                  </td>
                </tr>
              ) : isLoading || !data ? (
                <tr>
                  <td colSpan={5} style={{ color: "#8794a8" }}>
                    Loading…
                  </td>
                </tr>
              ) : filteredRows.length === 0 ? (
                <tr>
                  <td colSpan={5} style={{ color: "#8794a8", padding: 18 }}>
                    No settings match "{search}"
                  </td>
                </tr>
              ) : (
                filteredRows.map((setting) => {
                  const index = rows.indexOf(setting);
                  const locked = setting.type === "locked";
                  const touched = setting.lastChangedAt
                    ? `${new Date(setting.lastChangedAt).toLocaleDateString("en-GB", {
                        day: "2-digit",
                        month: "short",
                        year: "numeric",
                      })} · ${setting.lastChangedBy}`
                    : "—";
                  return (
                    <tr
                      key={setting.key}
                      onClick={() => !locked && setEditingIndex(index)}
                      style={{ cursor: locked ? "default" : "pointer" }}
                    >
                      <td>
                        <b className={locked ? undefined : "lnk"}>{setting.key}</b>
                        {setting.hint && (
                          <>
                            <br />
                            <span style={{ color: "#8794a8", fontSize: 11 }}>{setting.hint}</span>
                          </>
                        )}
                      </td>
                      <td>
                        {setting.type === "toggle" ? (
                          setting.value ? (
                            <span className="st ok">
                              <span className="d"></span>Enabled
                            </span>
                          ) : (
                            <span className="st" style={{ color: "#8a94a6" }}>
                              <span className="d" style={{ background: "#8a94a6" }}></span>Disabled
                            </span>
                          )
                        ) : (
                          String(setting.value)
                        )}
                      </td>
                      <td>
                        {locked ? <span className="tag">Locked</span> : <span className="tag o">Editable</span>}
                      </td>
                      <td style={{ fontSize: 11.5, color: "#8794a8" }}>{touched}</td>
                      <td style={{ color: locked ? "transparent" : "#a9b3c2" }}>⋮</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <LegacyHelpPanel topicKey="orgset" />
      </div>

      {editingSetting && (
        <EditDrawer
          setting={editingSetting}
          onClose={() => setEditingIndex(null)}
          saving={mutation.isPending}
          onSave={(value) => {
            if (editingIndex === null) return;
            mutation.mutate({ index: editingIndex, value });
          }}
        />
      )}

      {bulkEditing && (
        <BulkEditDrawer
          categoryLabel={activeLabel}
          settings={rows}
          saving={bulkMutation.isPending}
          onClose={() => setBulkEditing(false)}
          onSave={(updates) => bulkMutation.mutate(updates)}
        />
      )}
    </>
  );
}
