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

-- Admin > Contact Center > Queues page edits a much richer object (members,
-- routing strategy, bullseye rings, ACW, division) than ACD/analytics need —
-- name/max_wait_s above stay exactly as every other query already depends
-- on; the admin-only fields live in config so nothing else has to change.
ALTER TABLE queues ADD COLUMN IF NOT EXISTS division TEXT;
ALTER TABLE queues ADD COLUMN IF NOT EXISTS config JSONB NOT NULL DEFAULT '{}'::jsonb;

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

-- Admin > Telephony > Trunks page fields — priority/enabled/is_platform above
-- are what carrier.py's BYOC route resolver actually reads; these are purely
-- the richer profile the Trunks admin UI edits (type/transport/servers/
-- codecs/caller ID/edge-group/in-service state), added without disturbing it.
ALTER TABLE trunks ADD COLUMN IF NOT EXISTS type TEXT;
ALTER TABLE trunks ADD COLUMN IF NOT EXISTS transport TEXT;
ALTER TABLE trunks ADD COLUMN IF NOT EXISTS servers TEXT;
ALTER TABLE trunks ADD COLUMN IF NOT EXISTS codecs TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE trunks ADD COLUMN IF NOT EXISTS caller_id TEXT;
ALTER TABLE trunks ADD COLUMN IF NOT EXISTS edge_group TEXT;
ALTER TABLE trunks ADD COLUMN IF NOT EXISTS state TEXT NOT NULL DEFAULT 'In-Service';

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

-- Admin > Telephony > DID Numbers page assigns a DID to a Person or a
-- readable target label, not just flow_id/queue_id — plain text columns
-- for the label the UI actually edits, same pattern as trunks' extra columns.
ALTER TABLE did_assignments ADD COLUMN IF NOT EXISTS assignment_type TEXT;
ALTER TABLE did_assignments ADD COLUMN IF NOT EXISTS target_label TEXT;

-- Edge Groups (Admin > Telephony > Edge Groups) are plain named-list
-- entities like ACD Skills/Languages, so they reuse simple_entities with
-- kind='edge_group' instead of a dedicated table.
CREATE TABLE IF NOT EXISTS edges (
  id SERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  model TEXT,
  edge_group TEXT,
  state TEXT NOT NULL DEFAULT 'Online'
);

-- Admin > Routing > Emergency Groups — no create/edit UI, only toggling an
-- existing group active/inactive, so flows is just a snapshot list rather
-- than a normalised join.
CREATE TABLE IF NOT EXISTS emergency_groups (
  id SERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  flows TEXT[] NOT NULL DEFAULT '{}',
  active BOOLEAN NOT NULL DEFAULT false
);

-- Admin > Contact Center > Email Settings — verified sending domains and
-- the inbound addresses routed off each one.
CREATE TABLE IF NOT EXISTS email_domains (
  id SERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  domain TEXT NOT NULL,
  verified BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS email_addresses (
  id SERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  addr TEXT NOT NULL,
  route TEXT,
  target TEXT
);

-- Admin > Quality & WEM > Evaluation Forms — groups/questions edited live
-- in the form builder, committed as one JSONB blob on Save (same pattern
-- as flows.graph) rather than a normalised groups/questions schema.
CREATE TABLE IF NOT EXISTS eval_forms (
  id SERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  published BOOLEAN NOT NULL DEFAULT false,
  groups JSONB NOT NULL DEFAULT '[]'::jsonb
);

-- Admin > Contact Center > Recording Policies. queues stores the local
-- queue ids as plain text, not a real FK — same simplification as Call
-- Routes' flow reference (see resources.py's call-routes comment).
CREATE TABLE IF NOT EXISTS recording_policies (
  id SERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  media TEXT[] NOT NULL DEFAULT '{}',
  queues TEXT[] NOT NULL DEFAULT '{}',
  retention INTEGER NOT NULL DEFAULT 365,
  pct INTEGER NOT NULL DEFAULT 100,
  active BOOLEAN NOT NULL DEFAULT true
);

-- Admin > Contact Center > Schedules (business-hours groups a flow's
-- Schedule node checks against — distinct from Admin > WEM > Schedules,
-- the agent-shift WFM feature, which isn't covered by this table).
CREATE TABLE IF NOT EXISTS schedule_groups (
  id SERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  open_hours TEXT,
  holidays TEXT,
  state TEXT NOT NULL DEFAULT 'Open'
);

-- Admin > Contact Center > Scripts (the list Script Editor opens into).
-- Only name/type/published persist — the visual drag-drop canvas itself
-- (scriptView(), window.SCR) is a deep in-place editor, same known gap
-- as Architect's flow-node editing.
CREATE TABLE IF NOT EXISTS scripts (
  id SERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT,
  published BOOLEAN NOT NULL DEFAULT false
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

-- ============================================================
-- People & Permissions — Divisions, ACD Skills, ACD Languages
-- (frontend/src/features/people-permissions). These were purely
-- localStorage-backed on the frontend; this is real backing for them.
-- Roles/Groups/SSO/OAuth Clients in that same feature area need their
-- own join tables and aren't covered here — a separate follow-up.
-- ============================================================

-- code (not a serial id) is the primary key, and it's the SAME slug already
-- stored in users.division (d_home/d_ret/d_dig/d_col/d_man, from the
-- Performance-page work) — so a person's division tag resolves to a real
-- name here with no separate join/id-mapping layer.
CREATE TABLE IF NOT EXISTS divisions (
  code TEXT PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  is_home BOOLEAN NOT NULL DEFAULT false
);

-- ACD Skills and ACD Languages are both just a flat named-list entity —
-- one table with a `kind` discriminator rather than two near-identical ones.
CREATE TABLE IF NOT EXISTS simple_entities (
  id SERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,   -- 'skill' | 'lang'
  name TEXT NOT NULL,
  description TEXT
);

CREATE INDEX IF NOT EXISTS idx_simple_entities_tenant_kind ON simple_entities(tenant_id, kind);

-- ============================================================
-- Directory Module — tables backing the directory-redesign.ts
-- REST endpoints (/api/directory/*). Each entity is tenant-scoped.
-- People reuses the existing users table; these cover the rest.
-- ============================================================

-- Directory people — richer profile than the core users table.
-- Stores the full contact-centre person object that the directory
-- workspace needs (skills, queues, languages, timezone, etc.).
CREATE TABLE IF NOT EXISTS dir_people (
  id SERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  title TEXT,
  dept TEXT,
  division TEXT,
  location TEXT,
  email TEXT,
  phone TEXT,
  ext TEXT,
  presence TEXT NOT NULL DEFAULT 'Offline',
  station TEXT,
  manager TEXT,
  licence TEXT,
  tz TEXT,
  started TEXT,
  skills TEXT[] DEFAULT '{}',
  langs TEXT[] DEFAULT '{}',
  queues TEXT[] DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_dir_people_tenant ON dir_people(tenant_id);

-- Ring/hunt groups
CREATE TABLE IF NOT EXISTS dir_groups (
  id SERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT,
  ext TEXT,
  ring TEXT,
  owner TEXT,
  member_ids INTEGER[] DEFAULT '{}',
  voicemail BOOLEAN NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS idx_dir_groups_tenant ON dir_groups(tenant_id);

-- Physical / virtual sites
CREATE TABLE IF NOT EXISTS dir_locations (
  id SERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT,
  address TEXT,
  country TEXT,
  tz TEXT,
  hours TEXT,
  floors TEXT[] DEFAULT '{}',
  emergency TEXT,
  site TEXT,
  status TEXT NOT NULL DEFAULT 'Operational'
);
CREATE INDEX IF NOT EXISTS idx_dir_locations_tenant ON dir_locations(tenant_id);

-- Custom profile fields (admin-managed)
CREATE TABLE IF NOT EXISTS dir_profile_fields (
  id SERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  key TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'Text',
  section TEXT,
  visibility TEXT NOT NULL DEFAULT 'Everyone',
  required BOOLEAN NOT NULL DEFAULT false,
  system BOOLEAN NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS idx_dir_profile_fields_tenant ON dir_profile_fields(tenant_id);

-- Contacts outside the organisation
CREATE TABLE IF NOT EXISTS dir_external_contacts (
  id SERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  org TEXT,
  role TEXT,
  email TEXT,
  phone TEXT,
  relationship TEXT,
  last_contact TEXT,
  owner TEXT
);
CREATE INDEX IF NOT EXISTS idx_dir_external_contacts_tenant ON dir_external_contacts(tenant_id);

-- Document workspaces
CREATE TABLE IF NOT EXISTS dir_workspaces (
  id SERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT,
  owner TEXT,
  access TEXT,
  docs INTEGER NOT NULL DEFAULT 0,
  size TEXT,
  updated TEXT,
  retention TEXT
);
CREATE INDEX IF NOT EXISTS idx_dir_workspaces_tenant ON dir_workspaces(tenant_id);

-- Per-user favourite entries (person / group / contact)
CREATE TABLE IF NOT EXISTS dir_favourites (
  id SERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_id INTEGER NOT NULL,
  target_type TEXT NOT NULL,  -- 'people' | 'groups' | 'external'
  UNIQUE(tenant_id, user_id, target_id, target_type)
);
CREATE INDEX IF NOT EXISTS idx_dir_favourites_user ON dir_favourites(user_id);

-- Chat threads between directory people
CREATE TABLE IF NOT EXISTS dir_thread_messages (
  id SERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  thread_id INTEGER NOT NULL,   -- the dir_people id of the other party
  sender TEXT NOT NULL,          -- 'me' | 'them'
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_dir_thread_messages_thread ON dir_thread_messages(tenant_id, thread_id);

-- Call log
CREATE TABLE IF NOT EXISTS dir_calls (
  id SERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  target_id INTEGER,
  target_name TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ,
  duration_s INTEGER
);
CREATE INDEX IF NOT EXISTS idx_dir_calls_tenant ON dir_calls(tenant_id);

-- Activity / audit feed for directory actions
CREATE TABLE IF NOT EXISTS dir_activity (
  id SERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_dir_activity_tenant ON dir_activity(tenant_id, created_at DESC);

-- Roles: integer PK, so unlike divisions this rides the generic resource
-- registry (backend/resources.py) directly — no dedicated routes needed.
-- perms is a flat "Domain:action" string array (matches PERMISSION_DOMAINS
-- in types.ts), not a normalised permissions table — nothing else joins
-- against individual permissions yet.
CREATE TABLE IF NOT EXISTS roles (
  id SERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  base BOOLEAN NOT NULL DEFAULT false,
  perms TEXT[] NOT NULL DEFAULT '{}'
);

-- "groups" is a reserved-adjacent word in SQL tooling, so the table is named
-- people_groups. members stores person ids directly (TEXT[], matching
-- users.id cast to text) rather than a join table — group membership here
-- is small, admin-edited lists, not something ever queried from the user side.
CREATE TABLE IF NOT EXISTS people_groups (
  id SERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'Official',
  ext TEXT,
  ring TEXT NOT NULL DEFAULT 'Sequential',
  members TEXT[] NOT NULL DEFAULT '{}',
  vm BOOLEAN NOT NULL DEFAULT false
);

-- ============================================================
-- SSO Providers — stores OIDC/SAML identity provider configs
-- per tenant. Each provider has a discovery URL (for OIDC) or
-- metadata (for SAML), client credentials, and domain mapping.
-- ============================================================

CREATE TABLE IF NOT EXISTS sso_providers (
  id SERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,                       -- display name, e.g. 'Microsoft Entra ID'
  protocol TEXT NOT NULL DEFAULT 'oidc',    -- 'oidc' | 'saml'
  -- OIDC fields
  issuer_url TEXT,                          -- e.g. https://login.microsoftonline.com/{tenant}/v2.0
  client_id TEXT,
  client_secret TEXT,                       -- encrypted/hashed in prod, plain for prototype
  discovery_url TEXT,                       -- .well-known/openid-configuration URL
  -- SAML fields
  metadata_url TEXT,
  entity_id TEXT,
  -- Common
  domain_hint TEXT,                         -- e.g. 'mcmgroup.com' — auto-routes users by email domain
  scopes TEXT NOT NULL DEFAULT 'openid email profile',
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sso_providers_tenant ON sso_providers(tenant_id);

DROP TRIGGER IF EXISTS trg_sso_providers_touch ON sso_providers;
CREATE TRIGGER trg_sso_providers_touch BEFORE UPDATE ON sso_providers
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- Temporary state during the SSO redirect flow (CSRF protection).
-- Deleted after callback or after expiry.
CREATE TABLE IF NOT EXISTS sso_states (
  state TEXT PRIMARY KEY,
  provider_id INTEGER NOT NULL REFERENCES sso_providers(id) ON DELETE CASCADE,
  redirect_uri TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);

-- ============================================================
-- OAuth Clients — external apps that access MCM's API using
-- client_credentials or authorization_code grant. Each client
-- belongs to a tenant and has scoped permissions.
-- ============================================================

CREATE TABLE IF NOT EXISTS oauth_clients (
  id SERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  client_id TEXT NOT NULL UNIQUE,           -- public identifier
  client_secret_hash TEXT NOT NULL,         -- hashed secret
  scopes TEXT NOT NULL DEFAULT 'read',      -- space-separated: 'read write admin'
  redirect_uris TEXT[] DEFAULT '{}',        -- for authorization_code flow
  grant_types TEXT NOT NULL DEFAULT 'client_credentials', -- 'client_credentials' | 'authorization_code'
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_oauth_clients_tenant ON oauth_clients(tenant_id);
CREATE INDEX IF NOT EXISTS idx_oauth_clients_client_id ON oauth_clients(client_id);

DROP TRIGGER IF EXISTS trg_oauth_clients_touch ON oauth_clients;
CREATE TRIGGER trg_oauth_clients_touch BEFORE UPDATE ON oauth_clients
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- Tokens issued to OAuth clients (short-lived, revocable)
CREATE TABLE IF NOT EXISTS oauth_tokens (
  token TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES oauth_clients(client_id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  scopes TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_oauth_tokens_expires ON oauth_tokens(expires_at);

-- ============================================================
-- Apps Module — installed/available integrations catalogue backing
-- frontend/src/mcm/apps-redesign.ts's Apps > Installed / Available tabs
-- (see backend/apps.py for the /api/apps/* endpoints). One table for both
-- lists (same pattern as simple_entities' kind discriminator above): a row
-- is "available" while installed = false and moves into "installed" the
-- same way any other toggle would, rather than being copied into a second
-- table — install/uninstall is just flipping that flag plus its status
-- fields, not a structural move.
-- ============================================================
CREATE TABLE IF NOT EXISTS apps (
  id TEXT PRIMARY KEY,                 -- stable slug, e.g. 'salesforce-cti' — matches the frontend's app.id
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  category TEXT NOT NULL,              -- machine code: 'crm' | 'uc' | 'ticketing' | 'analytics' | ...
  category_label TEXT NOT NULL,        -- display label shown in the category badge
  description TEXT NOT NULL DEFAULT '',
  icon TEXT NOT NULL DEFAULT '',       -- icon key the frontend maps to an SVG (see APP_ICONS in apps-redesign.ts)
  permissions TEXT[] NOT NULL DEFAULT '{}',
  installed BOOLEAN NOT NULL DEFAULT false,
  status TEXT NOT NULL DEFAULT 'inactive',           -- 'active' | 'inactive' | 'error'
  status_label TEXT NOT NULL DEFAULT 'Inactive',
  integration_status TEXT NOT NULL DEFAULT 'Not connected',
  last_sync_label TEXT,                -- human text ('2 minutes ago') — this app has no real sync engine yet
  installed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_apps_tenant_installed ON apps(tenant_id, installed);

DROP TRIGGER IF EXISTS trg_apps_touch ON apps;
CREATE TRIGGER trg_apps_touch BEFORE UPDATE ON apps
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ============================================================
-- Callbacks & queue voicemail (Performance › Callbacks tab) — plain
-- CRUD entities, registered in resources.py's generic registry rather
-- than a hand-written blueprint (see resources.py's own comment on why
-- interactions.py is the exception, not the rule).
-- ============================================================
CREATE TABLE IF NOT EXISTS callbacks (
  id SERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_name TEXT NOT NULL,
  ani TEXT NOT NULL,
  queue_name TEXT,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  due_at TIMESTAMPTZ,                  -- NULL = as soon as an agent is free
  origin TEXT NOT NULL DEFAULT 'Agent scheduled',
  state TEXT NOT NULL DEFAULT 'Waiting',   -- Waiting | In progress | Completed | Cancelled
  agent_id INTEGER REFERENCES users(id),
  notes TEXT
);
CREATE INDEX IF NOT EXISTS idx_callbacks_tenant_state ON callbacks(tenant_id, state);

CREATE TABLE IF NOT EXISTS voicemails (
  id SERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  from_name TEXT NOT NULL,
  ani TEXT,
  queue_name TEXT,
  left_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  duration_s INTEGER NOT NULL DEFAULT 0,
  transcript TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT 'New'     -- New | Played
);
CREATE INDEX IF NOT EXISTS idx_voicemails_tenant_state ON voicemails(tenant_id, state);

-- Post-interaction CSAT/NPS surveys (Performance › Speech & Text tab).
-- score/nps are still generated client-side from the same synthetic
-- sentiment heuristic that drives the rest of that tab — there's no real
-- customer-facing survey form yet — but the records themselves persist for
-- real now instead of living only in a browser tab's in-memory DB.
CREATE TABLE IF NOT EXISTS surveys (
  id SERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_name TEXT,
  agent_name TEXT,
  queue_name TEXT,
  score INTEGER NOT NULL,      -- CSAT, 1-5
  nps INTEGER,                 -- 0-10
  comment TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_surveys_tenant_created ON surveys(tenant_id, created_at DESC);

-- ============================================================
-- Canned Responses Module — backs frontend/src/mcm/canned-redesign.ts's
-- Canned Responses library (see backend/canned.py for the /api/canned
-- endpoints). id is a stable slug (matches the frontend's fallback ids and
-- backend-generated ids alike), not SERIAL, same reasoning as licenses.code
-- and this file's own apps.id above. tenant_id is UUID + FK, matching every
-- other tenant-scoped table in this file — not the plain VARCHAR a literal
-- reading of the spec sheet would suggest, since a client-supplied
-- string tenant id can't be compared against tenants(id) UUID without an
-- explicit cast on every query, and can't carry the ON DELETE CASCADE
-- integrity the rest of this schema relies on.
CREATE TABLE IF NOT EXISTS canned_responses (
  id TEXT PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'general',
  category_label TEXT NOT NULL DEFAULT 'General',
  body TEXT NOT NULL DEFAULT '',
  substitution_fields TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_canned_responses_tenant_category ON canned_responses(tenant_id, category);

DROP TRIGGER IF EXISTS trg_canned_responses_touch ON canned_responses;
CREATE TRIGGER trg_canned_responses_touch BEFORE UPDATE ON canned_responses
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
