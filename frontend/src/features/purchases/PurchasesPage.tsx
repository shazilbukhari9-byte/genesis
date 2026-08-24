import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { LegacyBtn } from "../shared/LegacyBtn";
import { LegacyHelpPanel } from "../shared/LegacyHelpPanel";
import { toast } from "../shared/toast";
import { deletePurchase, fetchBudget, fetchPurchases, updateBudget } from "./purchasesService";
import type { Purchase } from "./types";

const QUERY_KEY = ["purchases"];
const BUDGET_KEY = ["purchases-budget"];

function goToAdminIndex(): void {
  const win = window as unknown as { adminIndex?: () => void; __hidePurchases?: () => void };
  win.__hidePurchases?.();
  win.adminIndex?.();
}

function currentMonthKey(): string {
  return new Date().toISOString().slice(0, 7); // "YYYY-MM"
}

function fmtMoney(n: number): string {
  return `£${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// Older rows (written before purchased_at stored a time) are a bare
// "YYYY-MM-DD" — Date parses that as UTC midnight, which is fine to fall
// back to date-only display for; anything with a time component renders it.
function fmtPurchasedAt(purchasedAt: string | null): string {
  if (!purchasedAt) return "—";
  const date = new Date(purchasedAt);
  if (Number.isNaN(date.getTime())) return purchasedAt;
  const datePart = date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  if (!purchasedAt.includes("T")) return datePart;
  const timePart = date.toTimeString().slice(0, 5);
  return `${datePart}, ${timePart}`;
}

// Purchase history is a record, not something anyone should be able to
// rewrite after the fact. Rows open this read-only view instead of an
// edit form; delete (with confirmation) is the only other action here.
function PurchaseDetailDrawer({
  purchase,
  onClose,
  onDelete,
}: {
  purchase: Purchase;
  onClose: () => void;
  onDelete: () => void;
}) {
  const rows: [string, string][] = [
    ["Item", purchase.item],
    ["Category", purchase.category ?? "—"],
    ["Price", purchase.price != null ? fmtMoney(purchase.price) : "—"],
    ["Purchased", fmtPurchasedAt(purchase.purchased_at)],
  ];

  return (
    <>
      <div id="scrim" onClick={onClose} />
      <div id="drw" style={{ height: "auto", top: "20%", bottom: "auto", borderRadius: "8px 0 0 8px" }}>
        <div className="dh">
          <h2>{purchase.item}</h2>
          <div className="x" onClick={onClose}>
            ×
          </div>
        </div>
        <div className="db">
          {rows.map(([label, value]) => (
            <div className="kv" key={label}>
              <span>{label}</span>
              <b>{value}</b>
            </div>
          ))}
        </div>
        <div className="df">
          <LegacyBtn
            secondary
            onClick={() => {
              if (confirm(`Delete "${purchase.item}"?`)) onDelete();
            }}
          >
            Delete purchase
          </LegacyBtn>
          <LegacyBtn secondary onClick={onClose}>
            Close
          </LegacyBtn>
        </div>
      </div>
    </>
  );
}

function BudgetPanel({ purchases }: { purchases: Purchase[] }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  const { data: budget } = useQuery({ queryKey: BUDGET_KEY, queryFn: fetchBudget });

  const saveMutation = useMutation({
    mutationFn: (value: number | null) => updateBudget(value),
    onSuccess: (updated) => {
      queryClient.setQueryData(BUDGET_KEY, updated);
      setEditing(false);
      toast(updated.monthly_limit != null ? `Monthly budget set to ${fmtMoney(updated.monthly_limit)}` : "Budget removed");
    },
    onError: () => toast("Couldn't save budget — try again."),
  });

  const monthKey = currentMonthKey();
  const monthSpend = purchases
    .filter((p) => (p.purchased_at ?? "").slice(0, 7) === monthKey)
    .reduce((sum, p) => sum + (p.price ?? 0), 0);

  const limit = budget?.monthly_limit ?? null;
  const pct = limit ? Math.min(100, Math.round((100 * monthSpend) / limit)) : 0;
  const barClass = limit == null ? "ok" : monthSpend > limit ? "full" : pct >= 80 ? "warn" : "ok";

  function startEdit() {
    setDraft(limit != null ? String(limit) : "");
    setEditing(true);
  }

  return (
    <div className="panel" style={{ marginBottom: 16 }}>
      <h3>
        Monthly Budget
        <span className="sp" />
        {!editing && (
          <LegacyBtn secondary style={{ fontSize: 11.5, height: 26, padding: "0 10px" }} onClick={startEdit}>
            {limit != null ? "Edit" : "Set budget"}
          </LegacyBtn>
        )}
      </h3>
      <div style={{ padding: "14px 16px" }}>
        {editing ? (
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ fontSize: 12.5, color: "#5b6a7d" }}>£</span>
            <input
              type="number"
              min="0"
              step="1"
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="No limit"
              style={{
                width: 120,
                height: 30,
                border: "1px solid #ccd4e0",
                borderRadius: 4,
                padding: "0 8px",
                fontSize: 12.5,
              }}
            />
            <LegacyBtn
              disabled={saveMutation.isPending}
              onClick={() => saveMutation.mutate(draft.trim() === "" ? null : Number(draft))}
            >
              Save
            </LegacyBtn>
            <LegacyBtn secondary onClick={() => setEditing(false)} disabled={saveMutation.isPending}>
              Cancel
            </LegacyBtn>
            {limit != null && (
              <LegacyBtn secondary onClick={() => saveMutation.mutate(null)} disabled={saveMutation.isPending}>
                Remove budget
              </LegacyBtn>
            )}
          </div>
        ) : limit == null ? (
          <div style={{ fontSize: 12.5, color: "#8794a8" }}>
            No monthly budget set. This month so far: <b>{fmtMoney(monthSpend)}</b>.
          </div>
        ) : (
          <>
            <div className="sc-bar-wrap" style={{ marginBottom: 6 }}>
              <div className="sc-bar-label">
                <span>
                  {fmtMoney(monthSpend)} of {fmtMoney(limit)}
                </span>
                <span>{pct}%</span>
              </div>
              <div className="sc-bar-track">
                <div className={`sc-bar-fill ${barClass}`} style={{ width: `${pct}%` }} />
              </div>
            </div>
            {monthSpend > limit ? (
              <div style={{ fontSize: 12, color: "#b3261e", fontWeight: 600 }}>
                Over budget by {fmtMoney(monthSpend - limit)} this month.
              </div>
            ) : (
              <div style={{ fontSize: 12, color: "#5b6a7d" }}>{fmtMoney(limit - monthSpend)} remaining this month.</div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function ExpenseTracker({ purchases }: { purchases: Purchase[] }) {
  const monthKey = currentMonthKey();

  const { totalAllTime, monthSpend, byCategory } = useMemo(() => {
    const totals = new Map<string, number>();
    let all = 0;
    let month = 0;
    for (const p of purchases) {
      const price = p.price ?? 0;
      all += price;
      if ((p.purchased_at ?? "").slice(0, 7) === monthKey) month += price;
      const cat = p.category?.trim() || "Uncategorized";
      totals.set(cat, (totals.get(cat) ?? 0) + price);
    }
    const sorted = Array.from(totals.entries()).sort((a, b) => b[1] - a[1]);
    return { totalAllTime: all, monthSpend: month, byCategory: sorted };
  }, [purchases, monthKey]);

  const maxCategory = byCategory[0]?.[1] ?? 0;

  return (
    <>
      <div className="kpis" style={{ marginBottom: 16 }}>
        <div className="kpi">
          <span>Total Spend</span>
          <b>{fmtMoney(totalAllTime)}</b>
        </div>
        <div className="kpi">
          <span>This Month</span>
          <b>{fmtMoney(monthSpend)}</b>
        </div>
        <div className="kpi">
          <span>Purchases</span>
          <b>{purchases.length}</b>
        </div>
        <div className="kpi">
          <span>Categories</span>
          <b>{byCategory.length}</b>
        </div>
      </div>

      {byCategory.length > 0 && (
        <div className="panel" style={{ marginBottom: 16 }}>
          <h3>Spend by Category</h3>
          <div className="bars">
            {byCategory.map(([cat, total]) => (
              <div className="brow" key={cat}>
                <div className="lb">{cat}</div>
                <div className="tr">
                  <i style={{ width: `${maxCategory ? Math.round((100 * total) / maxCategory) : 0}%` }} />
                </div>
                <div className="vl">{fmtMoney(total)}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

export function PurchasesPage() {
  const queryClient = useQueryClient();
  const [viewing, setViewing] = useState<Purchase | null>(null);
  const [search, setSearch] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: QUERY_KEY,
    queryFn: fetchPurchases,
  });

  const deleteMutation = useMutation({
    mutationFn: deletePurchase,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      setViewing(null);
      toast("Purchase deleted");
    },
    onError: () => toast("Couldn't delete purchase — try again."),
  });

  const purchases = data ?? [];
  const rows = purchases.filter((p) => {
    if (!search) return true;
    const haystack = `${p.item} ${p.category ?? ""}`.toLowerCase();
    return haystack.includes(search.toLowerCase());
  });

  return (
    <>
      <div className="phd">
        <div className="bc">
          <a onClick={goToAdminIndex}>Admin</a> › Account Settings
        </div>
        <div className="tt">
          <h1>Purchases</h1>
        </div>
      </div>

      <div className="pbody">
        {!isLoading && (
          <>
            <ExpenseTracker purchases={purchases} />
            <BudgetPanel purchases={purchases} />
          </>
        )}

        <div className="tbar">
          <input className="s" placeholder="Search purchases" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div className="tblw">
          <table className="dt">
            <thead>
              <tr>
                <th>Item</th>
                <th>Category</th>
                <th>Price</th>
                <th>Purchased</th>
                <th style={{ width: 40 }}></th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={5} style={{ textAlign: "center", color: "#8794a8", padding: 18 }}>
                    Loading…
                  </td>
                </tr>
              ) : rows.length ? (
                rows.map((p) => (
                  <tr key={p.id} onClick={() => setViewing(p)} style={{ cursor: "pointer" }}>
                    <td>
                      <b className="lnk">{p.item}</b>
                    </td>
                    <td>{p.category ?? "—"}</td>
                    <td>{p.price != null ? fmtMoney(p.price) : "—"}</td>
                    <td>{fmtPurchasedAt(p.purchased_at)}</td>
                    <td
                      style={{ color: "#a9b3c2", cursor: "pointer" }}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (confirm(`Delete "${p.item}"?`)) deleteMutation.mutate(p.id);
                      }}
                    >
                      ⋮
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={5} style={{ textAlign: "center", color: "#8794a8", padding: 18 }}>
                    No purchases yet — seat purchases from the Subscription page will appear here.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <LegacyHelpPanel topicKey="purch" />
      </div>

      {viewing && (
        <PurchaseDetailDrawer
          purchase={viewing}
          onClose={() => setViewing(null)}
          onDelete={() => deleteMutation.mutate(viewing.id)}
        />
      )}
    </>
  );
}
