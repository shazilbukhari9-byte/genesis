import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { LegacyBtn } from "../shared/LegacyBtn";
import { LegacyHelpPanel } from "../shared/LegacyHelpPanel";
import { toast } from "../shared/toast";
import { createPurchase, deletePurchase, fetchPurchases } from "./purchasesService";
import type { NewPurchase, Purchase } from "./types";

const QUERY_KEY = ["purchases"];

function goToAdminIndex(): void {
  const win = window as unknown as { adminIndex?: () => void; __hidePurchases?: () => void };
  win.__hidePurchases?.();
  win.adminIndex?.();
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function NewPurchaseDrawer({
  onClose,
  onSave,
  saving,
}: {
  onClose: () => void;
  onSave: (purchase: NewPurchase) => void;
  saving: boolean;
}) {
  const [item, setItem] = useState("");
  const [category, setCategory] = useState("");
  const [price, setPrice] = useState("");
  const [purchasedAt, setPurchasedAt] = useState(todayIso());

  const priceValid = price.trim() === "" || (Number.isFinite(Number(price)) && Number(price) >= 0);
  const canSave = item.trim().length > 0 && priceValid;

  return (
    <>
      <div id="scrim" onClick={onClose} />
      <div id="drw" style={{ height: "auto", top: "20%", bottom: "auto", borderRadius: "8px 0 0 8px" }}>
        <div className="dh">
          <h2>New Purchase</h2>
          <div className="x" onClick={onClose}>
            ×
          </div>
        </div>
        <div className="db">
          <div className="fld">
            <label>Item</label>
            <input value={item} onChange={(e) => setItem(e.target.value)} placeholder="e.g. CX 3 — WEM (Named)" />
          </div>
          <div className="fld">
            <label>Category</label>
            <input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="e.g. Licence, Add-on" />
          </div>
          <div className="fld">
            <label>Price (£)</label>
            <input type="number" min="0" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="0.00" />
            {!priceValid && <div style={{ color: "#b3261e", fontSize: 12, marginTop: 4 }}>Price can't be negative</div>}
          </div>
          <div className="fld">
            <label>Purchased</label>
            <input type="date" value={purchasedAt} onChange={(e) => setPurchasedAt(e.target.value)} />
          </div>
        </div>
        <div className="df">
          <LegacyBtn secondary onClick={onClose} disabled={saving}>
            Cancel
          </LegacyBtn>
          <LegacyBtn
            disabled={saving || !canSave}
            onClick={() =>
              onSave({
                item: item.trim(),
                category: category.trim() || undefined,
                price: price ? Number(price) : undefined,
                purchased_at: purchasedAt || undefined,
              })
            }
          >
            {saving ? "Saving…" : "Create purchase"}
          </LegacyBtn>
        </div>
      </div>
    </>
  );
}

// Purchase history is a record of what was bought, not an editable form —
// no field here is ever writable after the fact. Clicking a row shows
// every detail read-only instead of silently doing nothing.
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
    ["Price", purchase.price != null ? `£${purchase.price.toFixed(2)}` : "—"],
    ["Purchased", purchase.purchased_at ?? "—"],
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

export function PurchasesPage() {
  const queryClient = useQueryClient();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [viewing, setViewing] = useState<Purchase | null>(null);
  const [search, setSearch] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: QUERY_KEY,
    queryFn: fetchPurchases,
  });

  const createMutation = useMutation({
    mutationFn: createPurchase,
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      setDrawerOpen(false);
      toast(`Purchase saved — <b>${variables.item}</b>`);
    },
    onError: () => toast("Couldn't save purchase — try again."),
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

  const rows = (data ?? []).filter((p) => {
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
          <div className="rt">
            <LegacyBtn onClick={() => setDrawerOpen(true)}>+ New Purchase</LegacyBtn>
          </div>
        </div>
      </div>

      <div className="pbody">
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
                    <td>{p.price != null ? `£${p.price.toFixed(2)}` : "—"}</td>
                    <td>{p.purchased_at ?? "—"}</td>
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
                    No purchases yet
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <LegacyHelpPanel topicKey="purch" />
      </div>

      {drawerOpen && (
        <NewPurchaseDrawer
          onClose={() => setDrawerOpen(false)}
          saving={createMutation.isPending}
          onSave={(purchase) => createMutation.mutate(purchase)}
        />
      )}

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
