import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { LegacyBtn } from "../shared/LegacyBtn";
import { LegacyHelpPanel } from "../shared/LegacyHelpPanel";
import {
  createOAuthClient,
  deleteOAuthClient,
  fetchOAuthClients,
  revokeOAuthClient,
  rotateOAuthClientSecret,
  updateOAuthClient,
  type OneTimeSecret,
} from "./oauthService";
import { FUNCTIONAL_GRANT_TYPES, GRANT_TYPES, type OAuthClient } from "./types";

const QUERY_KEY = ["oauth-clients"];
const TABS = ["Clients", "Scopes", "Activity"];

type Draft = OAuthClient | (Omit<OAuthClient, "id" | "clientId" | "lastUsed" | "status"> & { status: OAuthClient["status"] });

function goToAdminIndex(): void {
  const win = window as unknown as { adminIndex?: () => void; __hideOauth?: () => void };
  win.__hideOauth?.();
  win.adminIndex?.();
}

function emptyDraft(): Draft {
  return { name: "", grantType: GRANT_TYPES[0] ?? "Client Credentials", scope: "", tokenDurationSec: 3600, status: "Active", redirectUris: [] };
}

function toast(message: string): void {
  (window as unknown as { toast?: (m: string) => void }).toast?.(message);
}

function copyToClipboard(text: string, label: string): void {
  navigator.clipboard.writeText(text).then(
    () => toast(`${label} copied`),
    () => toast(`Couldn't copy ${label.toLowerCase()} — select and copy it manually.`),
  );
}

export function OAuthClientsPage() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState(TABS[0]);
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<Draft | null>(null);
  const [redirectUrisText, setRedirectUrisText] = useState("");
  // The client secret is generated once, on the server, and only ever
  // returned in the create/rotate response — nothing shows it again after
  // this dialog closes, matching the backend's own one-time-reveal design.
  const [revealSecret, setRevealSecret] = useState<OneTimeSecret | null>(null);

  const { data, isLoading } = useQuery({ queryKey: QUERY_KEY, queryFn: fetchOAuthClients });

  function closeDrawer(): void {
    setEditing(null);
    setRedirectUrisText("");
  }

  function openDrawer(client: Draft): void {
    setEditing(client);
    setRedirectUrisText(client.redirectUris.join("\n"));
  }

  const createMutation = useMutation({
    mutationFn: createOAuthClient,
    onSuccess: ({ data: updated, secret }) => {
      queryClient.setQueryData(QUERY_KEY, updated);
      closeDrawer();
      if (secret) setRevealSecret(secret);
    },
  });
  const updateMutation = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Parameters<typeof updateOAuthClient>[1] }) => updateOAuthClient(id, patch),
    onSuccess: (updated, { patch }) => {
      queryClient.setQueryData(QUERY_KEY, updated);
      closeDrawer();
      toast(`Changes saved for <b>${patch.name}</b>`);
    },
  });
  const rotateMutation = useMutation({
    mutationFn: rotateOAuthClientSecret,
    onSuccess: (secret) => {
      // Both drawers render with id="drw" (same as every other page here) —
      // closing the edit drawer first avoids two of them mounting at once,
      // which left the secret reveal dialog invisible behind the first one.
      closeDrawer();
      if (secret) setRevealSecret(secret);
    },
    onError: () => toast("Couldn't rotate the secret — try again."),
  });
  const revokeMutation = useMutation({
    mutationFn: ({ id }: { id: string; name: string }) => revokeOAuthClient(id),
    onSuccess: (updated, { name }) => {
      queryClient.setQueryData(QUERY_KEY, updated);
      toast(`<b>${name}</b> revoked`);
    },
  });
  const deleteMutation = useMutation({
    mutationFn: ({ id }: { id: string; name: string }) => deleteOAuthClient(id),
    onSuccess: (updated, { name }) => {
      queryClient.setQueryData(QUERY_KEY, updated);
      closeDrawer();
      toast(`<b>${name}</b> deleted`);
    },
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

  function handleSave() {
    if (!editing) return;
    const redirectUris = redirectUrisText.split("\n").map((l) => l.trim()).filter(Boolean);
    if ("id" in editing) {
      updateMutation.mutate({
        id: editing.id,
        patch: { name: editing.name, grantType: editing.grantType, scope: editing.scope, redirectUris, status: editing.status },
      });
    } else {
      createMutation.mutate({ ...editing, redirectUris });
    }
  }

  function handleRotate() {
    if (!editing || !("id" in editing)) return;
    if (window.confirm("Rotate this client's secret? Every token already issued to it will stop working immediately.")) {
      rotateMutation.mutate(editing.id);
    }
  }

  const saving = createMutation.isPending || updateMutation.isPending;

  return (
    <>
      <div className="phd">
        <div className="bc">
          <a onClick={goToAdminIndex}>Admin</a> › People &amp; Permissions
        </div>
        <div className="tt">
          <h1>OAuth Clients</h1>
          <div className="rt">
            <LegacyBtn onClick={() => openDrawer(emptyDraft())}>+ Create Client</LegacyBtn>
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
                  ) : filtered.length === 0 ? (
                    <tr>
                      <td colSpan={9} style={{ color: "#8794a8", padding: 18 }}>
                        No OAuth clients yet — use "+ Create Client" to register one.
                      </td>
                    </tr>
                  ) : (
                    filtered.map((c) => (
                      <tr key={c.id} onClick={() => openDrawer(c)} style={{ cursor: "pointer" }}>
                        <td onClick={(e) => e.stopPropagation()}><input type="checkbox" /></td>
                        <td><b className="lnk">{c.name}</b></td>
                        <td>
                          {c.grantType}
                          {!FUNCTIONAL_GRANT_TYPES.includes(c.grantType) && (
                            <div style={{ fontSize: 11, color: "#e0a200" }}>Not yet functional</div>
                          )}
                        </td>
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
                              onClick={() => {
                                if (window.confirm(`Revoke "${c.name}"? It will stop being able to obtain new tokens until re-enabled.`)) {
                                  revokeMutation.mutate({ id: c.id, name: c.name });
                                }
                              }}
                            >
                              Revoke
                            </span>
                          )}
                          <span
                            style={{ color: "#8794a8", fontSize: 11.5, cursor: "pointer" }}
                            onClick={() => {
                              if (window.confirm(`Delete "${c.name}"? Its client ID and secret stop working immediately — this can't be undone.`)) {
                                deleteMutation.mutate({ id: c.id, name: c.name });
                              }
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

      {editing && (
        <>
          <div id="scrim" onClick={closeDrawer} />
          <div id="drw" style={{ height: "auto", top: "26%", bottom: "auto", borderRadius: "8px 0 0 8px" }}>
            <div className="dh">
              <h2>{"id" in editing ? `Edit — ${editing.name}` : "Create OAuth client"}</h2>
              <div className="x" onClick={closeDrawer}>×</div>
            </div>
            <div className="db">
              <div className="fld">
                <label>Client name</label>
                <input value={editing.name} onChange={(e) => setEditing((d) => (d ? { ...d, name: e.target.value } : d))} />
              </div>
              <div className="fld">
                <label>Grant type</label>
                <select value={editing.grantType} onChange={(e) => setEditing((d) => (d ? { ...d, grantType: e.target.value } : d))}>
                  {GRANT_TYPES.map((g) => (
                    <option key={g}>{g}</option>
                  ))}
                </select>
                {!FUNCTIONAL_GRANT_TYPES.includes(editing.grantType) && (
                  <div style={{ fontSize: 11.5, color: "#8794a8", marginTop: 4 }}>
                    Only Client Credentials issues working tokens today — a client using this grant type can be saved but can't sign in yet.
                  </div>
                )}
              </div>
              <div className="fld">
                <label>Roles / scope</label>
                <input value={editing.scope} onChange={(e) => setEditing((d) => (d ? { ...d, scope: e.target.value } : d))} placeholder="e.g. Analytics Read" />
              </div>
              <div className="fld">
                <label>Redirect URIs</label>
                <textarea
                  rows={2}
                  style={{ width: "100%", border: "1px solid #ccd4e0", borderRadius: 4, padding: 6, fontSize: 12.5, fontFamily: "inherit" }}
                  value={redirectUrisText}
                  placeholder={"One per line, e.g.\nhttps://app.mcmgroup.example/callback"}
                  onChange={(e) => setRedirectUrisText(e.target.value)}
                />
                <div style={{ fontSize: 11, color: "#8794a8", marginTop: 4 }}>Only used by grant types other than Client Credentials.</div>
              </div>
              <div className="fld">
                <label>Token duration</label>
                <div style={{ fontSize: 12.5, color: "#3d4a5c", padding: "4px 0" }}>
                  3,600 seconds (1 hour) — fixed for every client, not yet configurable individually.
                </div>
              </div>
              <div className="fld">
                <label>Status</label>
                <select
                  value={editing.status}
                  onChange={(e) => setEditing((d) => (d ? { ...d, status: e.target.value as OAuthClient["status"] } : d))}
                >
                  <option>Active</option>
                  <option>Disabled</option>
                </select>
                {!("id" in editing) && editing.status === "Disabled" && (
                  <div style={{ fontSize: 11, color: "#8794a8", marginTop: 4 }}>
                    The client will be created but can't obtain tokens until enabled.
                  </div>
                )}
              </div>

              {"id" in editing && (
                <>
                  <div className="sect">Secret</div>
                  <div className="fld">
                    <LegacyBtn secondary onClick={handleRotate} disabled={rotateMutation.isPending}>
                      {rotateMutation.isPending ? "Rotating…" : "Rotate secret"}
                    </LegacyBtn>
                    <div style={{ fontSize: 11, color: "#8794a8", marginTop: 6 }}>
                      Generates a new secret and immediately revokes every token issued with the old one.
                    </div>
                  </div>
                  <div className="fld" style={{ marginTop: 14 }}>
                    <LegacyBtn
                      secondary
                      onClick={() => {
                        if (window.confirm(`Delete "${editing.name}"? Its client ID and secret stop working immediately — this can't be undone.`)) {
                          deleteMutation.mutate({ id: editing.id, name: editing.name });
                        }
                      }}
                      disabled={deleteMutation.isPending}
                    >
                      {deleteMutation.isPending ? "Deleting…" : "Delete client"}
                    </LegacyBtn>
                  </div>
                </>
              )}
            </div>
            <div className="df">
              <LegacyBtn secondary onClick={closeDrawer} disabled={saving}>Cancel</LegacyBtn>
              <LegacyBtn onClick={handleSave} disabled={saving || !editing.name || !editing.scope}>
                {saving ? "Saving…" : "id" in editing ? "Save" : "Create"}
              </LegacyBtn>
            </div>
          </div>
        </>
      )}

      {revealSecret && (
        <>
          <div id="scrim" />
          <div id="drw" style={{ height: "auto", top: "30%", bottom: "auto", borderRadius: "8px 0 0 8px" }}>
            <div className="dh">
              <h2>Client secret</h2>
            </div>
            <div className="db">
              <div style={{ background: "#fdecea", border: "1px solid #f5c6c0", color: "#b3261e", borderRadius: 5, padding: "8px 11px", fontSize: 12.5, marginBottom: 12 }}>
                {revealSecret.notice}
              </div>
              <div className="fld">
                <label>Client ID</label>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <code style={{ flex: 1, fontSize: 12, background: "#f4f6f9", padding: "6px 8px", borderRadius: 4, wordBreak: "break-all" }}>
                    {revealSecret.clientId}
                  </code>
                  <LegacyBtn
                    secondary
                    onClick={() => copyToClipboard(revealSecret.clientId, "Client ID")}
                  >
                    Copy
                  </LegacyBtn>
                </div>
              </div>
              <div className="fld">
                <label>Client secret</label>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <code style={{ flex: 1, fontSize: 12, background: "#f4f6f9", padding: "6px 8px", borderRadius: 4, wordBreak: "break-all" }}>
                    {revealSecret.clientSecret}
                  </code>
                  <LegacyBtn
                    secondary
                    onClick={() => copyToClipboard(revealSecret.clientSecret, "Client secret")}
                  >
                    Copy
                  </LegacyBtn>
                </div>
              </div>
            </div>
            <div className="df">
              <LegacyBtn onClick={() => setRevealSecret(null)}>I've saved this — close</LegacyBtn>
            </div>
          </div>
        </>
      )}
    </>
  );
}
