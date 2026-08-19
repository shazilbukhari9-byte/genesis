import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, X } from "lucide-react";

import { LegacyBtn } from "../shared/LegacyBtn";
import { LegacyHelpPanel } from "../shared/LegacyHelpPanel";
import { fetchAuditLog } from "./auditLogService";
import { AUDIT_ACTION_TYPES, isWarningAction } from "./types";

const QUERY_KEY = ["audit-log"];

function goToAdminIndex(): void {
  const win = window as unknown as { adminIndex?: () => void; __hideAuditLog?: () => void };
  win.__hideAuditLog?.();
  win.adminIndex?.();
}

function exportCsv(rows: { when: string; who: string; action: string; detail?: string }[]): void {
  const escapeCell = (value: string) => (/[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);
  const lines = ["When,Who,Action,Detail"].concat(
    rows.map((r) => [r.when, r.who, r.action, r.detail ?? ""].map(escapeCell).join(",")),
  );
  const blob = new Blob([lines.join("\n")], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "audit_log.csv";
  a.click();
  URL.revokeObjectURL(a.href);
}

export function AuditLogPage() {
  const [search, setSearch] = useState("");
  const [who, setWho] = useState("");
  const [type, setType] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: QUERY_KEY,
    queryFn: fetchAuditLog,
    refetchInterval: 5000,
  });

  const entries = data ?? [];

  const whoOptions = useMemo(() => {
    const seen: string[] = [];
    entries.forEach((e) => {
      if (!seen.includes(e.who)) seen.push(e.who);
    });
    return seen;
  }, [entries]);

  const filtered = useMemo(() => {
    return entries.filter((e) => {
      if (who && e.who !== who) return false;
      if (type && !e.action.includes(type)) return false;
      if (search) {
        const haystack = `${e.action} ${e.detail ?? ""}`.toLowerCase();
        if (!haystack.includes(search.toLowerCase())) return false;
      }
      return true;
    });
  }, [entries, search, who, type]);

  const shown = filtered.slice(0, 200);
  const hasFilters = Boolean(search || who || type);

  return (
    <>
      <div className="phd">
        <div className="bc">
          <a onClick={goToAdminIndex}>Admin</a> › Account Settings
        </div>
        <div className="tt">
          <h1>Audit Log</h1>
          <div className="rt">
            <LegacyBtn secondary onClick={() => exportCsv(entries)}>
              ⭳ Export CSV
            </LegacyBtn>
          </div>
        </div>
        <div className="tabs">
          <div className="tb on">
            {filtered.length} entr{filtered.length === 1 ? "y" : "ies"}
            {filtered.length > 200 ? " — showing first 200" : ""}
          </div>
        </div>
      </div>

      <div className="pbody">
        <div className="tbar" style={{ gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <div
            style={{
              position: "relative",
              display: "flex",
              alignItems: "center",
              width: 280,
              background: "#fff",
              border: "1px solid #d5dce7",
              borderRadius: 7,
              padding: "0 10px",
              height: 34,
            }}
          >
            <Search size={14} color="#8a94a6" style={{ flex: "none" }} />
            <input
              placeholder="Search actions & detail…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{
                border: "none",
                outline: "none",
                background: "transparent",
                flex: 1,
                fontSize: 12.5,
                height: "100%",
                padding: "0 6px",
              }}
            />
            {search && (
              <X
                size={14}
                color="#a9b3c2"
                style={{ cursor: "pointer", flex: "none" }}
                onClick={() => setSearch("")}
              />
            )}
          </div>
<<<<<<< HEAD
          <select value={who} onChange={(e) => setWho(e.target.value)} style={{ fontSize: 12.5 }}>
=======
          <select
            value={who}
            onChange={(e) => setWho(e.target.value)}
            style={{
              fontSize: 12.5,
              height: 34,
              padding: "0 10px",
              background: "#fff",
              border: "1px solid #d5dce7",
              borderRadius: 7,
              color: "#20303f",
              outline: "none",
            }}
          >
>>>>>>> 2ca736438226df3e9d34ce710779ce4eb6064e7e
            <option value="">Everyone</option>
            {whoOptions.map((w) => (
              <option key={w}>{w}</option>
            ))}
          </select>
<<<<<<< HEAD
          <select value={type} onChange={(e) => setType(e.target.value)} style={{ fontSize: 12.5 }}>
=======
          <select
            value={type}
            onChange={(e) => setType(e.target.value)}
            style={{
              fontSize: 12.5,
              height: 34,
              padding: "0 10px",
              background: "#fff",
              border: "1px solid #d5dce7",
              borderRadius: 7,
              color: "#20303f",
              outline: "none",
            }}
          >
>>>>>>> 2ca736438226df3e9d34ce710779ce4eb6064e7e
            <option value="">All action types</option>
            {AUDIT_ACTION_TYPES.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
          <div className="sp" />
          {hasFilters && (
            <LegacyBtn
              secondary
              style={{ fontSize: 12 }}
              onClick={() => {
                setSearch("");
                setWho("");
                setType("");
              }}
            >
              Reset
            </LegacyBtn>
          )}
        </div>

        <div className="panel">
          <table className="dt">
            <thead>
              <tr>
                <th style={{ width: 120 }}>When</th>
                <th style={{ width: 150 }}>Who</th>
                <th style={{ width: 240 }}>Action</th>
                <th>Detail</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={4} style={{ textAlign: "center", color: "#8794a8", padding: 18 }}>
                    Loading…
                  </td>
                </tr>
              ) : shown.length ? (
                shown.map((entry, i) => {
                  const warn = isWarningAction(entry.action);
                  return (
                    <tr key={i}>
                      <td style={{ color: "#8794a8" }}>{entry.when}</td>
                      <td>
                        <b>{entry.who}</b>
                      </td>
                      <td style={warn ? { color: "#b3261e", fontWeight: 600 } : undefined}>{entry.action}</td>
                      <td style={{ fontSize: 12, color: "#5a6b85" }}>{entry.detail ?? ""}</td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={4} style={{ textAlign: "center", color: "#8794a8", padding: 18 }}>
                    No audit entries match
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <LegacyHelpPanel topicKey="orgset" />
      </div>
    </>
  );
}
