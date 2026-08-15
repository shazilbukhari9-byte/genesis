import type { OrgSetting, OrgSettingsCategory, OrgSettingsData } from "./types";

// -----------------------------------------------------------------------------
// Data access layer for Organization Settings.
//
// Everything above this line (the React page + react-query hooks) only talks
// to the three functions exported below and never touches storage directly.
// Right now they read/write localStorage; wiring up the real backend later is
// just swapping the bodies of these three functions for `fetch(...)` calls —
// nothing in the UI layer has to change.
// -----------------------------------------------------------------------------

const STORAGE_KEY = "mcm_org_settings";
const SIMULATED_LATENCY_MS = 250;

function delay<T>(value: T): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), SIMULATED_LATENCY_MS));
}

function defaultOrgSettings(): OrgSettingsData {
  return {
    general: [
      { key: "Organization name", value: "MCM Group PLC", type: "text" },
      {
        key: "Short name",
        value: "mcmgroup",
        type: "locked",
        hint: "Login identifier — cannot be changed after creation",
      },
      {
        key: "Organization ID",
        value: "8f14e45f-ceea-4d3b-9c7f-2b1a0d7e33aa",
        type: "locked",
        hint: "Give this to Customer Care when raising tickets",
      },
      { key: "Home region", value: "EU (London) — euw2", type: "locked", hint: "Set at org creation" },
      {
        key: "Default country code",
        value: "+44 (United Kingdom)",
        type: "select",
        options: ["+44 (United Kingdom)", "+1 (United States)", "+91 (India)", "+353 (Ireland)", "+65 (Singapore)"],
      },
      {
        key: "Default language",
        value: "English (United Kingdom)",
        type: "select",
        options: ["English (United Kingdom)", "English (United States)", "Hindi", "Spanish", "French"],
      },
      {
        key: "Time zone",
        value: "Europe/London",
        type: "select",
        options: ["Europe/London", "Europe/Dublin", "Asia/Kolkata", "America/New_York", "UTC"],
      },
      {
        key: "Date / time format",
        value: "DD/MM/YYYY · 24 hour",
        type: "select",
        options: ["DD/MM/YYYY · 24 hour", "MM/DD/YYYY · 12 hour", "YYYY-MM-DD · 24 hour"],
      },
    ],
    security: [
      { key: "Minimum password length", value: 12, type: "number", hint: "Genesys default minimum is 8" },
      { key: "Password expiry (days)", value: 90, type: "number" },
      { key: "Password history (previous passwords blocked)", value: 10, type: "number" },
      { key: "Session idle timeout (minutes)", value: 60, type: "number" },
      {
        key: "Require multi-factor authentication",
        value: true,
        type: "toggle",
        hint: "Applies to native logins; SSO users authenticate at the IdP",
      },
      { key: "Enforce SSO only (disable native passwords)", value: false, type: "toggle" },
      { key: "Allow MCM Care support access to configuration", value: true, type: "toggle" },
      { key: "Trusted IP ranges", value: "194.60.0.0/16, 10.20.0.0/16", type: "text" },
    ],
    branding: [
      { key: "Use custom logo in agent UI", value: true, type: "toggle" },
      { key: "Theme", value: "MCM Navy", type: "select", options: ["MCM Navy", "Light", "Dark", "High contrast"] },
      { key: "Accent colour", value: "#FF4F1F", type: "text" },
      { key: "Login page message", value: "Welcome to MCM Cloud CX", type: "text" },
    ],
    residency: [
      { key: "Core region (org home)", value: "EU (London) — euw2", type: "locked" },
      {
        key: "Preferred media region",
        value: "EU (London)",
        type: "select",
        options: ["EU (London)", "EU (Frankfurt)", "Asia (Mumbai)", "US East"],
      },
      {
        key: "Call recording storage",
        value: "EU (London)",
        type: "locked",
        hint: "Recordings stay in-region for UK-GDPR",
      },
      { key: "Transcript & analytics storage", value: "EU (London)", type: "locked" },
    ],
    beta: [
      { key: "Agent Copilot summaries", value: true, type: "toggle", hint: "AI wrap-up summaries after each call" },
      { key: "New analytics workspace", value: true, type: "toggle" },
      { key: "WebRTC codec v2 (Opus FEC)", value: false, type: "toggle" },
      {
        key: "Predictive routing pilot",
        value: false,
        type: "toggle",
        hint: "AI-matched agent selection on eligible queues",
      },
    ],
  };
}

function readStore(): OrgSettingsData {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw) {
    try {
      return JSON.parse(raw) as OrgSettingsData;
    } catch {
      // fall through to defaults on corrupt data
    }
  }
  const data = defaultOrgSettings();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  return data;
}

function writeStore(data: OrgSettingsData): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

export async function fetchOrgSettings(): Promise<OrgSettingsData> {
  return delay(readStore());
}

export async function updateOrgSetting(
  category: OrgSettingsCategory,
  index: number,
  value: OrgSetting["value"],
  changedBy: string,
): Promise<OrgSettingsData> {
  const data = readStore();
  const current = data[category][index];
  if (!current) return delay(data);
  const updated: OrgSetting = {
    key: current.key,
    value,
    type: current.type,
    ...(current.hint !== undefined ? { hint: current.hint } : {}),
    ...(current.options !== undefined ? { options: current.options } : {}),
    lastChangedAt: new Date().toISOString(),
    lastChangedBy: changedBy,
  };
  data[category][index] = updated;
  writeStore(data);
  return delay(data);
}
