import { apiFetch } from "../shared/backend";
import type { NewPurchase, Purchase } from "./types";

export async function fetchPurchases(): Promise<Purchase[]> {
  return apiFetch<Purchase[]>("/api/purchases?order=purchased_at DESC, id DESC&limit=200");
}

export async function createPurchase(purchase: NewPurchase): Promise<Purchase> {
  return apiFetch<Purchase>("/api/purchases", {
    method: "POST",
    body: JSON.stringify(purchase),
  });
}

export async function deletePurchase(id: number): Promise<void> {
  await apiFetch<{ ok: boolean }>(`/api/purchases/${id}`, { method: "DELETE" });
}
