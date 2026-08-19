import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { LegacyBtn } from "../shared/LegacyBtn";
import { LegacyHelpPanel } from "../shared/LegacyHelpPanel";
import { createOAuthClient, deleteOAuthClient, fetchOAuthClients, revokeOAuthClient } from "./oauthService";
import { GRANT_TYPES } from "./types";

const QUERY_KEY = ["oauth-clients"];
const TABS = ["Clients", "Scopes", "Activity"];

function goToAdminIndex(): void {
  const win = window as unknown as { adminIndex?: () => void; __hideOauth?: () => void };
  win.__hideOauth?.();
  win.adminIndex?.();
}

export function OAuthClientsPage() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState(TABS[0]);
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState<{ name: string; grantType: string; scope: string; tokenDurationSec: number } | null>(null);

  const { data, isLoading } = useQuery({ queryKey: QUERY_KEY, queryFn: fetchOAuthClients });

  const createMutation = useMutation({
    mutationFn: createOAuthClient,
    onSuccess: (updated) => {
      queryClient.setQueryData(QUERY_KEY, updated);
      setCreating(null);
    },
  });
  const revokeMutation = useMutation({
    mutationFn: revokeOAuthClient,
    onSuccess: (updated) => queryClient.setQueryData(QUERY_KEY, updated),
  });
  const deleteMutation = useMutation({
    mutationFn: deleteOAuthClient,
    onSuccess: (updated) => queryClient.setQueryData(QUERY_KEY, updated),
  });

  const clients = data ?? [];
  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return q ? clients.filter((c) => `${c.name} ${c.grantType} ${c.scope}`.toLowerCase().includes(q)) : clients;
  }, [clients, search]);

  function handleExport() {
    const escapeCell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    const lines = ["Client name,Grant type,Client ID,Scope,Token duration,Last used,Status"].concat(
      clients.map((c) =>
        [c.name, c.grantType, c.clientId, c.scope, `${c.tokenDurationSec}s`, c.lastUsed, c.status].map(escapeCell).join(","),
      ),
    );
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "oauth_clients.csv";
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
          <h1>OAuth Clients</h1>
          <div className="rt">
            <LegacyBtn onClick={() => setCreating({ name: "", grantType: GRANT_TYPES[0] ?? "Client Credentials", scope: "", tokenDurationSec: 3600 })}>
              + Create Client
            </LegacyBtn>
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
          <input className="s" placeholder="Search oauth clients" value={search} onChange={(e) => setSearch(e.target.value)} />
          <div className="chip">Division: All ▾</div>
          <div className="chip">Status: Any ▾</div>
          <div className="sp" />
          <div className="chip">⚙ Columns</div>
          <div className="chip" style={{ cursor: "pointer" }} onClick={() => queryClient.invalidateQueries({ queryKey: QUERY_KEY })}>
            ↻ Refresh
          </div>
        </div>

        {tab === "Clients" ? (
          <>
            <div className="tblw">
              <table className="dt">
                <thead>
                  <tr>
                    <th style={{ width: 34 }}><input type="checkbox" /></th>
                    <th>Client name ⇅</th>
                    <th>Grant type ⇅</th>
                    <th>Client ID ⇅</th>
                    <th>Roles / scope ⇅</th>
                    <th>Token duration ⇅</th>
                    <th>Last used ⇅</th>
                    <th>Status ⇅</th>
                    <th style={{ width: 40 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {isLoading ? (
                    <tr>
                      <td colSpan={9} style={{ color: "#8794a8", padding: 18 }}>Loading…</td>
                    </tr>
                  ) : (
                    filtered.map((c) => (
                      <tr key={c.id}>
                        <td><input type="checkbox" /></td>
                        <td><b>{c.name}</b></td>
                        <td>{c.grantType}</td>
                        <td style={{ fontFamily: "monospace", fontSize: 11.5 }}>{c.clientId}</td>
                        <td>{c.scope}</td>
                        <td>{c.tokenDurationSec.toLocaleString()} s</td>
                        <td>{c.lastUsed}</td>
                        <td>
                          <span className={"st" + (c.status === "Active" ? " ok" : "")}>
                            <span className="d" style={c.status !== "Active" ? { background: "#8a94a6" } : undefined}></span>
                            {c.status}
                          </span>
                          {c.statusNote && <div style={{ fontSize: 11, color: "#e0a200" }}>{c.statusNote}</div>}
                        </td>
                        <td onClick={(e) => e.stopPropagation()}>
                          {c.status === "Active" && (
                            <span
                              style={{ color: "#b3261e", fontSize: 11.5, marginRight: 10, cursor: "pointer" }}
                              onClick={() => revokeMutation.mutate(c.id)}
                            >
                              Revoke
                            </span>
                          )}
                          <span style={{ color: "#8794a8", fontSize: 11.5, cursor: "pointer" }} onClick={() => deleteMutation.mutate(c.id)}>
                            Delete
                          </span>
                        </td>
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
          <div style={{ color: "#8794a8", fontSize: 12.5, padding: 18 }}>{tab} is not built out yet.</div>
        )}

        <LegacyHelpPanel topicKey="oauth" />
      </div>

      {creating && (
        <>
          <div id="scrim" onClick={() => setCreating(null)} />
          <div id="drw" style={{ height: "auto", top: "26%", bottom: "auto", borderRadius: "8px 0 0 8px" }}>
            <div className="dh">
              <h2>Create OAuth client</h2>
              <div className="x" onClick={() => setCreating(null)}>×</div>
            </div>
            <div className="db">
              <div className="fld">
                <label>Client name</label>
                <input value={creating.name} onChange={(e) => setCreating((d) => (d ? { ...d, name: e.target.value } : d))} />
              </div>
              <div className="fld">
                <label>Grant type</label>
                <select value={creating.grantType} onChange={(e) => setCreating((d) => (d ? { ...d, grantType: e.target.value } : d))}>
                  {GRANT_TYPES.map((g) => (
                    <option key={g}>{g}</option>
                  ))}
                </select>
              </div>
              <div className="fld">
                <label>Roles / scope</label>
                <input value={creating.scope} onChange={(e) => setCreating((d) => (d ? { ...d, scope: e.target.value } : d))} placeholder="e.g. Analytics Read" />
              </div>
              <div className="fld">
                <label>Token duration (seconds)</label>
                <input
                  type="number"
                  value={creating.tokenDurationSec}
                  onChange={(e) => setCreating((d) => (d ? { ...d, tokenDurationSec: Number(e.target.value) } : d))}
                />
              </div>
            </div>
            <div className="df">
              <LegacyBtn secondary onClick={() => setCreating(null)} disabled={createMutation.isPending}>Cancel</LegacyBtn>
              <LegacyBtn
                onClick={() => createMutation.mutate(creating)}
                disabled={createMutation.isPending || !creating.name || !creating.scope}
              >
                {createMutation.isPending ? "Creating…" : "Create"}
              </LegacyBtn>
            </div>
          </div>
        </>
      )}
    </>
  );
}
