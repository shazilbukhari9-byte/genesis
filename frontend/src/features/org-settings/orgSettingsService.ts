import type { OrgSetting, OrgSettingsCategory, OrgSettingsData } from "./types";
import { apiFetch, TENANT_ID } from "../shared/backend";

// -----------------------------------------------------------------------------
// Data access layer for Organization Settings.
//
// Everything above this line (the React page + react-query hooks) only talks
// to the functions exported below and never touches storage directly.
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

// Used by the "+ Edit <category> Settings" bulk drawer — applies every
// changed field in the category in one write instead of one PATCH per
// field, so a partial failure can't leave some fields saved and others not.
export async function updateOrgSettingsBulk(
  category: OrgSettingsCategory,
  updates: { index: number; value: OrgSetting["value"] }[],
  changedBy: string,
): Promise<OrgSettingsData> {
  return apiFetch<OrgSettingsData>("/api/org-settings", {
    method: "PATCH",
    body: JSON.stringify({ tenant_id: TENANT_ID, category, updates, changed_by: changedBy }),
  });
}
