import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { LegacyBtn } from "../shared/LegacyBtn";
import { LegacyHelpPanel } from "../shared/LegacyHelpPanel";
import { deleteSsoProvider, fetchSsoProviders, upsertSsoProvider } from "./ssoService";
import type { SsoProvider } from "./types";

const QUERY_KEY = ["sso-providers"];
const TABS = ["Providers", "SCIM Provisioning", "Sign-in Policy"];

function goToAdminIndex(): void {
  const win = window as unknown as { adminIndex?: () => void; __hideSso?: () => void };
  win.__hideSso?.();
  win.adminIndex?.();
}

function emptyProvider(): Omit<SsoProvider, "id"> {
  return {
    name: "",
    type: "SAML 2.0",
    status: "Not configured",
    users: 0,
    nameIdFormat: "emailAddress",
    autoProvisionScim: true,
    signAuthRequests: true,
  };
}

function statusPill(status: SsoProvider["status"]) {
  if (status === "Enabled") return <span className="st ok"><span className="d"></span>Enabled</span>;
  if (status === "Disabled") return <span className="st" style={{ color: "#8a94a6" }}><span className="d" style={{ background: "#8a94a6" }}></span>Disabled</span>;
  return <span className="st" style={{ color: "#8a94a6" }}><span className="d" style={{ background: "#8a94a6" }}></span>Not configured</span>;
}

export function SsoPage() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState(TABS[0]);
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<SsoProvider | Omit<SsoProvider, "id"> | null>(null);

  const { data, isLoading } = useQuery({ queryKey: QUERY_KEY, queryFn: fetchSsoProviders });

  const saveMutation = useMutation({
    mutationFn: upsertSsoProvider,
    onSuccess: (updated) => {
      queryClient.setQueryData(QUERY_KEY, updated);
      setEditing(null);
    },
  });
  const deleteMutation = useMutation({
    mutationFn: deleteSsoProvider,
    onSuccess: (updated) => queryClient.setQueryData(QUERY_KEY, updated),
  });

  const providers = data ?? [];
  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return q ? providers.filter((p) => `${p.name} ${p.type}`.toLowerCase().includes(q)) : providers;
  }, [providers, search]);

  function handleExport() {
    const escapeCell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    const lines = ["Provider,Type,Status,Certificate expiry,Users,Default"].concat(
      providers.map((p) =>
        [p.name, p.type, p.status, p.certExpiry ?? "", String(p.users), p.isDefault ? "Yes" : ""].map(escapeCell).join(","),
      ),
    );
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "sso_providers.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <>
      <div className="phd">
        <div className="bc">
          <a onClick={goToAdminIndex}>Admin</a> › People &amp; Permissions
        </div>
        <div className="tt">
          <h1>Single Sign-on</h1>
          <div className="rt">
            <LegacyBtn onClick={() => setEditing(emptyProvider())}>+ Configure Provider</LegacyBtn>
            <LegacyBtn secondary onClick={handleExport}>Export</LegacyBtn>
          </div>
        </div>
        <div className="tabs">
          {TABS.map((t) => (
            <div key={t} className={"tb" + (tab === t ? " on" : "")} style={{ cursor: "pointer" }} onClick={() => setTab(t)}>
              {t}
            </div>
          ))}
        </div>
      </div>

      <div className="pbody">
        <div className="tbar">
          <input className="s" placeholder="Search single sign-on" value={search} onChange={(e) => setSearch(e.target.value)} />
          <div className="chip">Division: All ▾</div>
          <div className="chip">Status: Any ▾</div>
          <div className="sp" />
          <div className="chip">⚙ Columns</div>
          <div className="chip" style={{ cursor: "pointer" }} onClick={() => queryClient.invalidateQueries({ queryKey: QUERY_KEY })}>
            ↻ Refresh
          </div>
        </div>

        {tab === "Providers" ? (
          <>
            <div className="tblw">
              <table className="dt">
                <thead>
                  <tr>
                    <th style={{ width: 34 }}><input type="checkbox" /></th>
                    <th>Provider ⇅</th>
                    <th>Type ⇅</th>
                    <th>Status ⇅</th>
                    <th>Certificate expiry ⇅</th>
                    <th>Users ⇅</th>
                    <th>Default ⇅</th>
                    <th style={{ width: 40 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {isLoading ? (
                    <tr>
                      <td colSpan={8} style={{ color: "#8794a8", padding: 18 }}>Loading…</td>
                    </tr>
                  ) : (
                    filtered.map((p) => (
                      <tr key={p.id} onClick={() => setEditing(p)} style={{ cursor: "pointer" }}>
                        <td onClick={(e) => e.stopPropagation()}><input type="checkbox" /></td>
                        <td><b className="lnk">{p.name}</b></td>
                        <td>{p.type}</td>
                        <td>
                          {statusPill(p.status)}
                          {p.statusNote && <div style={{ fontSize: 11, color: "#e0a200" }}>{p.statusNote}</div>}
                        </td>
                        <td>{p.certExpiry ?? "—"}</td>
                        <td>{p.users || "—"}</td>
                        <td>{p.isDefault ? <span className="tag">Default</span> : "—"}</td>
                        <td style={{ color: "#a9b3c2" }}>⋮</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <div className="pgr">
              <span>Showing 1–{filtered.length} of {filtered.length}</span>
              <div className="sp" />
              <span>Rows per page 25 ▾</span>
              <span>‹ ›</span>
            </div>
          </>
        ) : (
          <div style={{ color: "#8794a8", fontSize: 12.5, padding: 18 }}>
            {tab} is not built out yet.
          </div>
        )}

        <LegacyHelpPanel topicKey="sso" />
      </div>

      {editing && (
        <>
          <div id="scrim" onClick={() => setEditing(null)} />
          <div id="drw" style={{ height: "auto", top: "26%", bottom: "auto", borderRadius: "8px 0 0 8px" }}>
            <div className="dh">
              <h2>{"id" in editing ? "Edit provider" : "Configure provider"}</h2>
              <div className="x" onClick={() => setEditing(null)}>×</div>
            </div>
            <div className="db">
              <div className="fld">
                <label>Provider name</label>
                <input value={editing.name} onChange={(e) => setEditing((d) => (d ? { ...d, name: e.target.value } : d))} />
              </div>
              <div className="fld">
                <label>Type</label>
                <select value={editing.type} onChange={(e) => setEditing((d) => (d ? { ...d, type: e.target.value } : d))}>
                  <option>SAML 2.0</option>
                  <option>OIDC</option>
                  <option>SCIM 2.0</option>
                </select>
              </div>
              <div className="fld">
                <label>Status</label>
                <select
                  value={editing.status}
                  onChange={(e) => setEditing((d) => (d ? { ...d, status: e.target.value as SsoProvider["status"] } : d))}
                >
                  <option>Enabled</option>
                  <option>Disabled</option>
                  <option>Not configured</option>
                </select>
              </div>

              <div className="sect">SAML settings</div>
              <div className="fld">
                <label>Issuer URI</label>
                <input
                  value={editing.samlIssuerUri ?? ""}
                  placeholder="https://sts.windows.net/8f14e45f/"
                  onChange={(e) => setEditing((d) => (d ? { ...d, samlIssuerUri: e.target.value } : d))}
                />
              </div>
              <div className="fld">
                <label>Target URL (SSO endpoint)</label>
                <input
                  value={editing.samlTargetUrl ?? ""}
                  placeholder="https://login.microsoftonline.com/.../saml2"
                  onChange={(e) => setEditing((d) => (d ? { ...d, samlTargetUrl: e.target.value } : d))}
                />
              </div>
              <div className="fld">
                <label>Certificate</label>
                <input
                  value={editing.certificate ?? ""}
                  placeholder="entra-signing-2026.cer"
                  onChange={(e) => setEditing((d) => (d ? { ...d, certificate: e.target.value } : d))}
                />
              </div>
              <div className="fld">
                <label>NameID format</label>
                <select
                  value={editing.nameIdFormat ?? "emailAddress"}
                  onChange={(e) => setEditing((d) => (d ? { ...d, nameIdFormat: e.target.value as SsoProvider["nameIdFormat"] } : d))}
                >
                  <option value="emailAddress">emailAddress</option>
                  <option value="persistent">persistent</option>
                  <option value="unspecified">unspecified</option>
                </select>
              </div>

              <div className="sect">Behaviour</div>
              <div className="tgl">
                <input
                  type="checkbox"
                  checked={!!editing.allowPasswordFallback}
                  onChange={(e) => setEditing((d) => (d ? { ...d, allowPasswordFallback: e.target.checked } : d))}
                  style={{ width: "auto", marginRight: 6 }}
                />
                Allow MCM password sign-in as fallback
              </div>
              <div className="tgl">
                <input
                  type="checkbox"
                  checked={!!editing.autoProvisionScim}
                  onChange={(e) => setEditing((d) => (d ? { ...d, autoProvisionScim: e.target.checked } : d))}
                  style={{ width: "auto", marginRight: 6 }}
                />
                Auto-provision new users (SCIM)
              </div>
              <div className="tgl">
                <input
                  type="checkbox"
                  checked={!!editing.signAuthRequests}
                  onChange={(e) => setEditing((d) => (d ? { ...d, signAuthRequests: e.target.checked } : d))}
                  style={{ width: "auto", marginRight: 6 }}
                />
                Sign authentication requests
              </div>
              <div className="fld">
                <label>Relying party identifier</label>
                <input
                  value={editing.relyingPartyId ?? ""}
                  placeholder="https://login.mcmcloud.com"
                  onChange={(e) => setEditing((d) => (d ? { ...d, relyingPartyId: e.target.value } : d))}
                />
              </div>
              <div style={{ fontSize: 11, color: "#8794a8", marginTop: 8 }}>
                SAML settings and Behaviour above are reference fields — this environment's
                real sign-in flow is OIDC-based, configured outside this drawer.
              </div>

              {"id" in editing && (
                <div className="fld">
                  <LegacyBtn secondary onClick={() => { deleteMutation.mutate(editing.id); setEditing(null); }}>
                    Delete provider
                  </LegacyBtn>
                </div>
              )}
            </div>
            <div className="df">
              <LegacyBtn secondary onClick={() => setEditing(null)} disabled={saveMutation.isPending}>Cancel</LegacyBtn>
              <LegacyBtn onClick={() => saveMutation.mutate(editing)} disabled={saveMutation.isPending || !editing.name}>
                {saveMutation.isPending ? "Saving…" : "Save"}
              </LegacyBtn>
            </div>
          </div>
        </>
      )}
    </>
  );
}
