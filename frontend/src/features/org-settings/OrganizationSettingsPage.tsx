import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { LegacyBtn } from "../shared/LegacyBtn";
import { LegacyHelpPanel } from "../shared/LegacyHelpPanel";
import { fetchOrgSettings, updateOrgSetting } from "./orgSettingsService";
import { ORG_SETTINGS_CATEGORIES, type OrgSetting, type OrgSettingsCategory } from "./types";

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
            {setting.type === "toggle" && (
              <div className="tgl">
                <input
                  type="checkbox"
                  checked={Boolean(draft)}
                  onChange={(e) => setDraft(e.target.checked)}
                  style={{ width: "auto", marginRight: 6 }}
                />
                Enabled
              </div>
            )}
            {setting.type === "select" && (
              <select value={String(draft)} onChange={(e) => setDraft(e.target.value)}>
                {setting.options?.map((opt) => (
                  <option key={opt}>{opt}</option>
                ))}
              </select>
            )}
            {(setting.type === "text" || setting.type === "number") && (
              <input
                type={setting.type === "number" ? "number" : "text"}
                value={String(draft)}
                onChange={(e) => setDraft(setting.type === "number" ? Number(e.target.value) : e.target.value)}
              />
            )}
          </div>
        </div>
        <div className="df">
          <LegacyBtn secondary onClick={onClose} disabled={saving}>
            Cancel
          </LegacyBtn>
          <LegacyBtn onClick={() => onSave(draft)} disabled={saving}>
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

  const { data, isLoading } = useQuery({
    queryKey: QUERY_KEY,
    queryFn: fetchOrgSettings,
  });

  const mutation = useMutation({
    mutationFn: ({ index, value }: { index: number; value: OrgSetting["value"] }) =>
      updateOrgSetting(activeTab, index, value, currentUserName()),
    onSuccess: (updated) => {
      queryClient.setQueryData(QUERY_KEY, updated);
      setEditingIndex(null);
    },
  });

  const rows = data?.[activeTab] ?? [];
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
            <LegacyBtn disabled={!rows.length} onClick={() => rows.length && setEditingIndex(0)}>
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
              onClick={() => setActiveTab(cat.id)}
            >
              {cat.label}
            </div>
          ))}
        </div>
      </div>

      <div className="pbody">
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
              {isLoading || !data ? (
                <tr>
                  <td colSpan={5} style={{ color: "#8794a8" }}>
                    Loading…
                  </td>
                </tr>
              ) : (
                rows.map((setting, index) => {
                  const locked = setting.type === "locked";
                  const touched = setting.lastChangedAt
                    ? `${new Date(setting.lastChangedAt).toLocaleDateString("en-GB", {
                        day: "2-digit",
                        month: "short",
                        year: "numeric",
                      })} · ${setting.lastChangedBy}`
                    : "—";
                  return (
                    <tr key={setting.key} onClick={() => !locked && setEditingIndex(index)}>
                      <td>
                        <b className="lnk">{setting.key}</b>
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
                      <td style={{ color: "#a9b3c2" }}>⋮</td>
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
    </>
  );
}
