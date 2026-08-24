import type { OrgSetting, OrgSettingsCategory, OrgSettingsData } from "./types";
import { apiFetch, TENANT_ID } from "../shared/backend";

// -----------------------------------------------------------------------------
// Data access layer for Organization Settings.
//
// Everything above this line (the React page + react-query hooks) only talks
// to the two functions exported below and never touches storage directly.
// Backed by GET/PATCH /api/org-settings (see backend/org_settings.py) — one
// JSONB settings document per tenant, matching this exact shape.
// -----------------------------------------------------------------------------

export async function fetchOrgSettings(): Promise<OrgSettingsData> {
  return apiFetch<OrgSettingsData>(`/api/org-settings?tenant_id=${TENANT_ID}`);
}

export async function updateOrgSetting(
  category: OrgSettingsCategory,
  index: number,
  value: OrgSetting["value"],
  changedBy: string,
): Promise<OrgSettingsData> {
  return apiFetch<OrgSettingsData>("/api/org-settings", {
    method: "PATCH",
    body: JSON.stringify({ tenant_id: TENANT_ID, category, index, value, changed_by: changedBy }),
  });
}
