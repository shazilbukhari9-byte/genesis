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
