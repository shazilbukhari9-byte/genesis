import { apiFetch } from "../shared/backend";
import type { Budget, Purchase } from "./types";

// Purchase history is a record of what was bought (or removed) elsewhere —
// Subscription's Add/Remove Seats, see backend/app.py's add_seats() and
// remove_seats() — not something this page creates or edits directly.
// Deliberately no createPurchase()/deletePurchase(): a spend record should
// never be alterable from the page that's supposed to be its audit trail.
export async function fetchPurchases(): Promise<Purchase[]> {
  return apiFetch<Purchase[]>("/api/purchases?order=purchased_at DESC, id DESC&limit=200");
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
