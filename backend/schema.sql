CREATE TABLE IF NOT EXISTS licenses (
  code TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  purchased INTEGER NOT NULL,
  unit_price REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  license_code TEXT REFERENCES licenses(code),
  state TEXT NOT NULL DEFAULT 'Active'
);

CREATE TABLE IF NOT EXISTS usage_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  metric TEXT NOT NULL,       -- 'voice_min' | 'sms' | 'storage_gb' | 'ai_tokens'
  amount REAL NOT NULL,
  recorded_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS invoices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  period_label TEXT NOT NULL,
  reference TEXT NOT NULL,
  total REAL NOT NULL,
  status TEXT NOT NULL         -- 'Open' | 'Paid'
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  who TEXT NOT NULL,
  action TEXT NOT NULL,
  detail TEXT,
  created_at TEXT NOT NULL
);

-- Authorized Organizations (multi-tenant trust relationships)
CREATE TABLE IF NOT EXISTS authorized_organizations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_name TEXT NOT NULL,
  org_id TEXT UNIQUE NOT NULL,      -- external org UUID shown in the UI
  domain TEXT,                      -- e.g. 'retail.ie.mcmgroup.com · EU (Dublin)'
  relationship TEXT NOT NULL,       -- 'Trustee' | 'Trustor' | 'Owner'
  scope_roles TEXT NOT NULL,        -- JSON array of role names
  divisions TEXT NOT NULL,          -- JSON array of division names
  expires_at TEXT,                  -- ISO date; NULL = permanent (owner tenant)
  status TEXT NOT NULL,             -- 'Active' | 'Expiring soon' | 'Owner' | 'Revoked'
  notes TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS authorized_org_audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp TEXT NOT NULL,
  org_domain TEXT,
  actor_name TEXT NOT NULL,
  action_text TEXT NOT NULL
);
