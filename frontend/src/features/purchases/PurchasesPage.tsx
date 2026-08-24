import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { LegacyBtn } from "../shared/LegacyBtn";
import { LegacyHelpPanel } from "../shared/LegacyHelpPanel";
import { toast } from "../shared/toast";
import { createPurchase, deletePurchase, fetchPurchases, updatePurchase } from "./purchasesService";
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

function PurchaseDrawer({
  purchase,
  onClose,
  onSave,
  onDelete,
  saving,
}: {
  purchase: Purchase | null;
  onClose: () => void;
  onSave: (purchase: NewPurchase) => void;
  onDelete?: () => void;
  saving: boolean;
}) {
  const isNew = purchase === null;
  const [item, setItem] = useState(purchase?.item ?? "");
  const [category, setCategory] = useState(purchase?.category ?? "");
  const [price, setPrice] = useState(purchase?.price != null ? String(purchase.price) : "");
  const [purchasedAt, setPurchasedAt] = useState(purchase?.purchased_at ?? todayIso());

  const priceValid = price.trim() === "" || (Number.isFinite(Number(price)) && Number(price) >= 0);
  const canSave = item.trim().length > 0 && priceValid;

  return (
    <>
      <div id="scrim" onClick={onClose} />
      <div id="drw" style={{ height: "auto", top: "20%", bottom: "auto", borderRadius: "8px 0 0 8px" }}>
        <div className="dh">
          <h2>{isNew ? "New Purchase" : `Edit — ${purchase.item}`}</h2>
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
          {!isNew && onDelete && (
            <div className="fld" style={{ marginTop: 14 }}>
              <LegacyBtn
                secondary
                onClick={() => {
                  if (window.confirm(`Delete "${purchase.item}"?`)) onDelete();
                }}
              >
                Delete purchase
              </LegacyBtn>
            </div>
          )}
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
            {saving ? "Saving…" : isNew ? "Create purchase" : "Save changes"}
          </LegacyBtn>
        </div>
      </div>
    </>
  );
}

export function PurchasesPage() {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<Purchase | "new" | null>(null);
  const [search, setSearch] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: QUERY_KEY,
    queryFn: fetchPurchases,
  });

  const createMutation = useMutation({
    mutationFn: createPurchase,
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      setEditing(null);
      toast(`Purchase saved — <b>${variables.item}</b>`);
    },
    onError: () => toast("Couldn't save purchase — try again."),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, purchase }: { id: number; purchase: NewPurchase }) => updatePurchase(id, purchase),
    onSuccess: (_data, { purchase }) => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      setEditing(null);
      toast(`Purchase saved — <b>${purchase.item}</b>`);
    },
    onError: () => toast("Couldn't save purchase — try again."),
  });

  const deleteMutation = useMutation({
    mutationFn: deletePurchase,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      setEditing(null);
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
            <LegacyBtn onClick={() => setEditing("new")}>+ New Purchase</LegacyBtn>
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
                  <tr key={p.id} onClick={() => setEditing(p)} style={{ cursor: "pointer" }}>
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

      {editing && (
        <PurchaseDrawer
          purchase={editing === "new" ? null : editing}
          saving={createMutation.isPending || updateMutation.isPending}
          onClose={() => setEditing(null)}
          onSave={(purchase) =>
            editing === "new" ? createMutation.mutate(purchase) : updateMutation.mutate({ id: editing.id, purchase })
          }
          {...(editing !== "new" ? { onDelete: () => deleteMutation.mutate(editing.id) } : {})}
        />
      )}
    </>
  );
}
