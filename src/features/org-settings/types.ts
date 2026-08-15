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
