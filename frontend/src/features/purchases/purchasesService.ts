import { apiFetch } from "../shared/backend";
import type { Budget, Purchase } from "./types";

// Purchase history is a record of what was bought elsewhere (currently:
// Subscription seat purchases — see backend/app.py's add_seats()), not
// something this page creates directly — there is deliberately no
// createPurchase() here. deletePurchase covers correcting a bad record.
export async function fetchPurchases(): Promise<Purchase[]> {
  return apiFetch<Purchase[]>("/api/purchases?order=purchased_at DESC, id DESC&limit=200");
}

export async function deletePurchase(id: number): Promise<void> {
  await apiFetch<{ ok: boolean }>(`/api/purchases/${id}`, { method: "DELETE" });
}

export async function fetchBudget(): Promise<Budget> {
  return apiFetch<Budget>("/api/purchases/budget");
}

export async function updateBudget(monthlyLimit: number | null): Promise<Budget> {
  return apiFetch<Budget>("/api/purchases/budget", {
    method: "PUT",
    body: JSON.stringify({ monthly_limit: monthlyLimit }),
  });
}
