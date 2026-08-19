CREATE TABLE IF NOT EXISTS licenses (
  code TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  purchased INTEGER NOT NULL,
  unit_price REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL,      -- references tenants(id), added below (tenants created after this table)
  name TEXT NOT NULL,
  license_code TEXT REFERENCES licenses(code),
  state TEXT NOT NULL DEFAULT 'Active'
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT;
<<<<<<< HEAD
=======
-- division is a simple free-text tag (matches the frontend's fixed 5-division
-- set: d_home/d_ret/d_dig/d_col/d_man) rather than a normalised divisions
-- table + FK — there's no other real usage of divisions as entities yet.
ALTER TABLE users ADD COLUMN IF NOT EXISTS division TEXT;
-- People page (frontend/src/features/people-permissions) fields — plain
-- text, same reasoning as division above.
ALTER TABLE users ADD COLUMN IF NOT EXISTS title TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS dept TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS station TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS ext TEXT;

-- Real auth (fixes login/signup silently accepting any credentials and
-- matching the wrong user). email must be unique so login can look a user
-- up by it unambiguously; NULL is still allowed (Postgres treats each NULL
-- as distinct, so legacy seeded rows without an email don't collide).
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_unique ON users(email) WHERE email IS NOT NULL;
>>>>>>> 2ca736438226df3e9d34ce710779ce4eb6064e7e

CREATE TABLE IF NOT EXISTS usage_log (
  id SERIAL PRIMARY KEY,
  metric TEXT NOT NULL,       -- 'voice_min' | 'sms' | 'storage_gb' | 'ai_tokens'
  amount REAL NOT NULL,
  recorded_at TIMESTAMP NOT NULL
);

CREATE TABLE IF NOT EXISTS invoices (
  id SERIAL PRIMARY KEY,
  period_label TEXT NOT NULL,
  reference TEXT NOT NULL,
  total REAL NOT NULL,
  status TEXT NOT NULL         -- 'Open' | 'Paid'
);

CREATE TABLE IF NOT EXISTS audit_log (
  id SERIAL PRIMARY KEY,
  who TEXT NOT NULL,
  action TEXT NOT NULL,
  detail TEXT,
  created_at TIMESTAMP NOT NULL
);

-- Generic resource-registry entities (see resources.py) live below this line.
CREATE TABLE IF NOT EXISTS purchases (
  id SERIAL PRIMARY KEY,
  item TEXT NOT NULL,
  category TEXT,
  price REAL,
  purchased_at TEXT
);

-- ============================================================
-- Domain model (Section 09) — interactions is the fact table;
-- everything descends from tenants; see interactions.py for the
-- state machine that owns writes to these tables.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TABLE IF NOT EXISTS tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$ BEGIN
  ALTER TABLE users ADD CONSTRAINT users_tenant_id_fkey
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_tenants_touch ON tenants;
CREATE TRIGGER trg_tenants_touch BEFORE UPDATE ON tenants
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TABLE IF NOT EXISTS interactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  -- identity
  provider_sid TEXT,               -- non-null = real carrier call, NULL = simulated
  direction TEXT NOT NULL,         -- 'inbound' | 'outbound'
  media TEXT NOT NULL,             -- 'Voice' | 'Message' | ...

  -- parties (names denormalised on purpose — see doc)
  customer_name TEXT,
  ani TEXT,
  dnis TEXT,
  queue_id INTEGER,             -- references queues(id), added below (queues created after this table)
  queue_name TEXT,
  agent_id INTEGER REFERENCES users(id),
  agent_name TEXT,

  -- routing
  flow_id UUID,
  campaign_id INTEGER,          -- references campaigns(id), added below

  -- outcome
  result TEXT NOT NULL DEFAULT 'Active',  -- Active | Handled | Abandoned | Voicemail | Transferred
  wrapup TEXT,

  -- durations (computed at transition time, never derived at read time)
  wait_s INTEGER,
  talk_s INTEGER,
  hold_s INTEGER,
  acw_s INTEGER,

  -- quality
  recording_url TEXT,
  sentiment REAL,
  csat INTEGER,

  -- timing (answered_at IS NULL is the definition of "still waiting")
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  answered_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,

  -- carrier
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,

  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS trg_interactions_touch ON interactions;
CREATE TRIGGER trg_interactions_touch BEFORE UPDATE ON interactions
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- every analytics query filters on tenant_id first (see analytics.py) — these
-- four composite indexes, all leading with tenant_id, are what those queries
-- are shaped to hit, replacing a plain tenant_id index that only covered the
-- first WHERE term and not the second
CREATE INDEX IF NOT EXISTS idx_interactions_tenant_started ON interactions(tenant_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_interactions_tenant_queue_started ON interactions(tenant_id, queue_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_interactions_tenant_agent_started ON interactions(tenant_id, agent_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_interactions_tenant_result ON interactions(tenant_id, result);

-- the queue this interaction is waiting in, used by the FOR UPDATE SKIP LOCKED claim query
CREATE INDEX IF NOT EXISTS idx_interactions_waiting
  ON interactions(queue_id, started_at)
  WHERE answered_at IS NULL AND result = 'Active';

-- append-only event log: ivr | queue | talk | hold | transfer | acw | monitor | recording | retention
CREATE TABLE IF NOT EXISTS interaction_segments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  interaction_id UUID NOT NULL REFERENCES interactions(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ,
  meta JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_segments_interaction ON interaction_segments(interaction_id);

-- ============================================================
-- ACD engine (Section 10) — agent state lives on users; queues,
-- campaigns and DNC support the sweep and the simulated dialer.
-- See acd.py for the logic that owns writes here.
-- ============================================================

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS presence TEXT NOT NULL DEFAULT 'Offline',
  ADD COLUMN IF NOT EXISTS on_queue BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS routing_status TEXT NOT NULL DEFAULT 'Off Queue';

CREATE TABLE IF NOT EXISTS presence_events (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  presence TEXT NOT NULL,
  on_queue BOOLEAN NOT NULL,
  routing_status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS queues (
  id SERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  max_wait_s INTEGER NOT NULL DEFAULT 300
);

CREATE TABLE IF NOT EXISTS campaigns (
  id SERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS dnc_list (
  id SERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  phone_number TEXT NOT NULL,
  UNIQUE(tenant_id, phone_number)
);

-- digital-channel message thread; an agent reply with complete=true ends
-- the interaction in the same request (see acd.py post_message)
CREATE TABLE IF NOT EXISTS messages (
  id SERIAL PRIMARY KEY,
  interaction_id UUID NOT NULL REFERENCES interactions(id) ON DELETE CASCADE,
  from_agent BOOLEAN NOT NULL,
  body TEXT NOT NULL,
  complete BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- FKs added after their target tables exist (queues/campaigns are created
-- after interactions, so these can't be inline column constraints above)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'interactions_queue_id_fkey') THEN
    ALTER TABLE interactions ADD CONSTRAINT interactions_queue_id_fkey FOREIGN KEY (queue_id) REFERENCES queues(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'interactions_campaign_id_fkey') THEN
    ALTER TABLE interactions ADD CONSTRAINT interactions_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES campaigns(id);
  END IF;
END $$;

-- ============================================================
-- Carrier layer (Section 11) — only the parts that don't need a
-- real Twilio account: number normalisation config, BYOC trunk
-- priority, call-route matching, DID fallback, and flow graphs
-- for the interpreter. See carrier.py and flow.py.
-- ============================================================

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS default_dial_prefix TEXT NOT NULL DEFAULT '1';

-- customer trunks in priority order; the locked platform carrier
-- (is_platform=true) is appended last in code, not stored with a real
-- priority, so a misconfigured customer trunk always degrades to it
CREATE TABLE IF NOT EXISTS trunks (
  id SERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 100,
  enabled BOOLEAN NOT NULL DEFAULT true,
  is_platform BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS flows (
  id SERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  graph JSONB NOT NULL DEFAULT '{"nodes":[],"links":[]}'::jsonb
);

CREATE TABLE IF NOT EXISTS call_routes (
  id SERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  match_type TEXT NOT NULL,        -- 'exact' | 'prefix' | 'regex'
  pattern TEXT NOT NULL,
  destination_type TEXT NOT NULL,  -- 'flow' | 'queue' | 'user' | 'external_number'
  flow_id INTEGER REFERENCES flows(id),
  queue_id INTEGER REFERENCES queues(id),
  user_id INTEGER REFERENCES users(id),
  external_number TEXT,
  priority INTEGER NOT NULL DEFAULT 100,
  enabled BOOLEAN NOT NULL DEFAULT true,
  description TEXT
);

-- both queried as "WHERE tenant_id = %s ... ORDER BY priority, name" (carrier.py)
CREATE INDEX IF NOT EXISTS idx_trunks_tenant_priority ON trunks(tenant_id, priority);
CREATE INDEX IF NOT EXISTS idx_call_routes_tenant_priority ON call_routes(tenant_id, priority);

-- fallback when no call_route pattern matches a dialled DID
CREATE TABLE IF NOT EXISTS did_assignments (
  id SERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  phone_number TEXT NOT NULL,
  destination_type TEXT NOT NULL,
  flow_id INTEGER REFERENCES flows(id),
  queue_id INTEGER REFERENCES queues(id),
  UNIQUE(tenant_id, phone_number)
);

-- Now that flows/queues exist, wire the interactions.flow_id FK too.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'interactions_flow_id_fkey') THEN
    ALTER TABLE interactions ALTER COLUMN flow_id TYPE INTEGER USING NULL;
    ALTER TABLE interactions ADD CONSTRAINT interactions_flow_id_fkey FOREIGN KEY (flow_id) REFERENCES flows(id);
  END IF;
END $$;

-- ============================================================
-- Analytics (Section 12) support — queue membership (referenced by
-- both /api/live/queues' staff count and /api/live/agents' queue
-- membership) and a service-level threshold per queue.
-- ============================================================

ALTER TABLE queues
  ADD COLUMN IF NOT EXISTS service_level_threshold_s INTEGER NOT NULL DEFAULT 20;

CREATE TABLE IF NOT EXISTS agent_queues (
  agent_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  queue_id INTEGER NOT NULL REFERENCES queues(id) ON DELETE CASCADE,
  PRIMARY KEY (agent_id, queue_id)
);

-- ============================================================
-- Organization Settings — the frontend (src/features/org-settings)
-- treats this as one settings document per tenant (categories of
-- key/value settings), not a normalised table, so that's how it's
-- stored: one JSONB blob per tenant, matching the shape already
-- produced by orgSettingsService.ts's defaultOrgSettings().
-- ============================================================

CREATE TABLE IF NOT EXISTS org_settings (
  tenant_id UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  data JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- Auth (Section 13) — a real bearer-token session, not a JWT (no
-- signing infrastructure needed for a single-server dev backend; an
-- opaque token looked up against this table does the same job).
-- "Prototype — any credentials will work" was already this app's own
-- stated behavior, so login here checks the user exists by name and
-- doesn't verify a password.
-- ============================================================

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

-- Per-tenant carrier settings (Section 14). Keys are namespaced
-- 'twilio.*'; auth_token and api_key_secret are never returned to the
-- browser — see platform_config.py's tenant_config()/get_config().
CREATE TABLE IF NOT EXISTS platform_config (
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value TEXT,
  PRIMARY KEY (tenant_id, key)
);
