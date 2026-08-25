import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { LegacyBtn } from "../shared/LegacyBtn";
import { LegacyHelpPanel } from "../shared/LegacyHelpPanel";
import { toast } from "../shared/toast";
import { assignLicence, fetchDirectory } from "./store";

const QUERY_KEY = ["people-directory"];

function goToAdminIndex(): void {
  const win = window as unknown as { adminIndex?: () => void; __hideLicences?: () => void };
  win.__hideLicences?.();
  win.adminIndex?.();
}

export function LicencesPage() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: QUERY_KEY, queryFn: fetchDirectory });

  const assignMutation = useMutation({
    mutationFn: ({ personId, name, oldLicense, newLicense }: { personId: string; name: string; oldLicense: string; newLicense: string }) =>
      assignLicence(personId, name, oldLicense, newLicense),
    onSuccess: (updated, { name, newLicense }) => {
      queryClient.setQueryData(QUERY_KEY, updated);
      toast(`<b>${name}</b> moved to <b>${newLicense}</b>`);
    },
  });

  const licenses = data?.licenses ?? {};
  const people = data?.people ?? [];
  const divisionName = (id: string) => data?.divisions.find((d) => d.id === id)?.name ?? id;
  const usedOf = (plan: string) => people.filter((p) => p.license === plan).length;

  return (
    <>
      <div className="phd">
        <div className="bc">
          <a onClick={goToAdminIndex}>Admin</a> › People &amp; Permissions
        </div>
        <div className="tt">
          <h1>Licence Assignment</h1>
          <div className="rt">
            <LegacyBtn secondary onClick={() => (window as unknown as { openPage?: (id: string) => void }).openPage?.("subs")}>
              View subscription
            </LegacyBtn>
          </div>
        </div>
        <div className="tabs">
          <div className="tb on">Seats</div>
        </div>
      </div>

      <div className="pbody">
        {isLoading ? (
          <div style={{ color: "#8794a8", padding: 18 }}>Loading…</div>
        ) : (
          <>
            <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 18 }}>
              {Object.entries(licenses).map(([plan, total]) => {
                const used = usedOf(plan);
                const ratio = total > 0 ? used / total : 0;
                const over = used > total;
                const barColor = over ? "#d9534f" : ratio > 0.9 ? "#e8a33d" : "#2eab6b";
                return (
                  <div key={plan} style={{ background: "#fff", border: "1px solid #dde3ec", borderRadius: 8, padding: "14px 16px", minWidth: 160 }}>
                    <div style={{ fontSize: 11, color: "#93a0b3", textTransform: "uppercase", fontWeight: 700, marginBottom: 6 }}>{plan}</div>
                    <div style={{ fontSize: 20, fontWeight: 700, color: over ? "#d9534f" : "#152550" }}>
                      {used} / {total}
                    </div>
                    <div style={{ fontSize: 11.5, color: over ? "#d9534f" : "#8794a8" }}>{over ? "Over-assigned!" : "seats assigned"}</div>
                    <div style={{ height: 6, background: "#eef1f6", borderRadius: 3, marginTop: 8, overflow: "hidden" }}>
                      <div style={{ width: `${Math.min(ratio, 1) * 100}%`, height: "100%", background: barColor }} />
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="tblw">
              <table className="dt">
                <thead>
                  <tr>
                    <th>User</th>
                    <th>Division</th>
                    <th>Status</th>
                    <th>Licence</th>
                  </tr>
                </thead>
                <tbody>
                  {people.map((p) => (
                    <tr key={p.id}>
                      <td>
                        <b>{p.name}</b>
                        <br />
                        <span style={{ color: "#8794a8", fontSize: 11 }}>{p.email}</span>
                      </td>
                      <td>{divisionName(p.division)}</td>
                      <td>
                        <span className={"st" + (p.state === "Active" ? " ok" : "")}>
                          <span className="d" style={p.state !== "Active" ? { background: "#8a94a6" } : undefined}></span>
                          {p.state}
                        </span>
                      </td>
                      <td>
                        <select
                          value={p.license}
                          onChange={(e) => assignMutation.mutate({ personId: p.id, name: p.name, oldLicense: p.license, newLicense: e.target.value })}
                        >
                          {Object.keys(licenses).map((l) => (
                            <option key={l}>{l}</option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        <LegacyHelpPanel topicKey="licassign" />
      </div>
    </>
  );
}
