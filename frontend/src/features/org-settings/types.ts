export type OrgSettingType = "text" | "number" | "select" | "toggle" | "locked";

export interface OrgSetting {
  key: string;
  value: string | number | boolean;
  type: OrgSettingType;
  hint?: string;
  options?: string[];
  lastChangedAt?: string;
  lastChangedBy?: string;
}

export type OrgSettingsCategory = "general" | "security" | "branding" | "residency" | "beta";

export type OrgSettingsData = Record<OrgSettingsCategory, OrgSetting[]>;

export const ORG_SETTINGS_CATEGORIES: { id: OrgSettingsCategory; label: string }[] = [
  { id: "general", label: "General" },
  { id: "security", label: "Security" },
  { id: "branding", label: "Branding" },
  { id: "residency", label: "Data Residency" },
  { id: "beta", label: "Beta Programme" },
];

const HEX_COLOUR_RE = /^#[0-9a-fA-F]{6}$/;

// Mirrors the UI prototype's saveOrgSetting() validation and backend/org_settings.py's
// _validate_setting_value() — kept in sync with both so the Save button disables
// before a doomed request round-trips, but the backend is the real enforcement point.
export function validateSettingValue(setting: OrgSetting, value: OrgSetting["value"]): string | null {
  if (setting.type === "number") {
    if (typeof value !== "number" || !Number.isFinite(value)) return `${setting.key} must be a number`;
    if (setting.key === "Minimum password length" && value < 8) return `${setting.key} must be at least 8`;
    if (value < 1) return `${setting.key} must be at least 1`;
  } else if (setting.type === "text") {
    if (typeof value !== "string" || !value.trim()) return `${setting.key} cannot be empty`;
    if (setting.key === "Accent colour" && !HEX_COLOUR_RE.test(value.trim())) {
      return `${setting.key} must be a hex colour like #FF4F1F`;
    }
  } else if (setting.type === "select") {
    if (!setting.options?.includes(String(value))) return `${String(value)} is not a valid option for ${setting.key}`;
  }
  return null;
}
