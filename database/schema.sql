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

-- Real invite flow (People & Permissions' "Create & invite"/"Send invite" --
-- previously just set state='Pending invite' with no email, no password, and
-- no way for the invited person to ever complete the loop). A token here is
-- exchanged via POST /api/auth/accept-invite for a password + Active state,
-- same shape as the sessions table's token+expiry pattern.
ALTER TABLE users ADD COLUMN IF NOT EXISTS invite_token TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS invite_expires_at TIMESTAMPTZ;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_invite_token_unique ON users(invite_token) WHERE invite_token IS NOT NULL;

-- People page (People & Permissions): role assignment, ACD skill
-- proficiency, and spoken languages. roles stores roles.id values as a
-- plain integer array (no FK — Postgres can't FK into an array column
-- without a trigger, and this mirrors how roles.perms is already a bare
-- TEXT[] with no enforced referential integrity either). skills is a
-- {skillName: proficiency 1-5} map rather than a join table, matching how
-- small/admin-edited this list is (same reasoning as people_groups.members).
ALTER TABLE users ADD COLUMN IF NOT EXISTS roles INTEGER[] NOT NULL DEFAULT '{}';
ALTER TABLE users ADD COLUMN IF NOT EXISTS skills JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE users ADD COLUMN IF NOT EXISTS langs TEXT[] NOT NULL DEFAULT '{}';
-- lang_proficiency is an addition beyond the UI prototype (which only ever
-- toggles a language on/off, no rating) so agents can be scored 1-5 per
-- language the same way they already are per skill, for language-aware
-- preferred-agent routing. langs stays the membership source of truth (the
-- legacy routing/WFM engine and the propagation cascade in app.py both key
-- off it as a plain array) — this is enrichment data alongside it, kept in
-- sync from the People page whenever a language is checked/unchecked.
ALTER TABLE users ADD COLUMN IF NOT EXISTS lang_proficiency JSONB NOT NULL DEFAULT '{}'::jsonb;

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

-- audit_log's tenant_id column is added further down, immediately after the
-- tenants table it references exists (see "audit_log predates multi-tenancy"
-- below). It cannot be declared here: this file creates audit_log before
-- tenants, so an inline REFERENCES at this point fails on a fresh database.

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

-- audit_log predates multi-tenancy and was never scoped to a tenant, so every
-- tenant's entries were mixed together with no isolation. Nullable for now —
-- init_db.py backfills existing NULL rows to the current tenant on startup,
-- since there's no way to recover which tenant an old unscoped row belonged to.
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS tenant_id UUID;
CREATE INDEX IF NOT EXISTS idx_audit_log_tenant ON audit_log(tenant_id, id DESC);
DO $$ BEGIN
  ALTER TABLE audit_log ADD CONSTRAINT audit_log_tenant_id_fkey
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- purchases predates multi-tenancy too — unlike licenses/invoices/usage_log
-- (see their comment in init_db.py: deliberately global, one shared demo
-- billing dataset), purchases is a per-admin order history with no rationale
-- for staying unscoped. Same nullable + startup-backfill treatment as above.
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS tenant_id UUID;
CREATE INDEX IF NOT EXISTS idx_purchases_tenant ON purchases(tenant_id);
DO $$ BEGIN
  ALTER TABLE purchases ADD CONSTRAINT purchases_tenant_id_fkey
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_tenants_touch ON tenants;
CREATE TRIGGER trg_tenants_touch BEFORE UPDATE ON tenants
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- One row per tenant, lazily created on first read (same pattern as
-- org_settings) — subscription status ('Active' | 'Cancelled') and whether
-- the next renewal charges automatically. A real billing provider would own
-- this; this app has none, so cancelling just stops implying future charges
-- rather than triggering an actual deprovisioning workflow.
CREATE TABLE IF NOT EXISTS subscription_state (
  tenant_id UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'Active',
  autopay BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One row per tenant, lazily created on first read. A single overall
-- monthly spending limit for the Purchases page's budget tool — not
-- per-category, matching the simpler of the two shapes this was scoped to.
CREATE TABLE IF NOT EXISTS purchase_budgets (
  tenant_id UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  monthly_limit REAL
);

-- One row per tenant — the dummy card on file for Subscription's checkout.
-- Deliberately never stores a full card number, even a fake one: only what
-- a real payment processor would ever hand back after tokenizing a card
-- (brand, last 4, expiry, cardholder name), the same "never persist the
-- secret itself" instinct as oauth_clients only ever storing a secret hash.
CREATE TABLE IF NOT EXISTS payment_methods (
  tenant_id UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  brand TEXT NOT NULL,
  last4 TEXT NOT NULL,
  exp_month INTEGER NOT NULL,
  exp_year INTEGER NOT NULL,
  cardholder_name TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

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
CREATE UNIQUE INDEX IF NOT EXISTS ux_queues_tenant_name ON queues (tenant_id, lower(name));

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
CREATE UNIQUE INDEX IF NOT EXISTS ux_flows_tenant_name ON flows (tenant_id, lower(name));

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

-- Admin > Architect > Call Routing edits a division per route too (a plain
-- division code, same bare-TEXT convention as queues.division above — no FK
-- table of division codes is enforced there either). schedule_id is added
-- further down, once schedule_groups exists (see below).
ALTER TABLE call_routes ADD COLUMN IF NOT EXISTS division TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS ux_call_routes_tenant_pattern ON call_routes (tenant_id, match_type, lower(pattern));

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

-- Admin > Telephony > DID Numbers page's DID block/range catalogue —
-- the ranges DID assignments must fall inside.
CREATE TABLE IF NOT EXISTS did_ranges (
  id SERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  country TEXT,
  start_number TEXT NOT NULL,
  end_number TEXT NOT NULL,
  provider TEXT
);
CREATE INDEX IF NOT EXISTS idx_did_ranges_tenant ON did_ranges(tenant_id);

-- Admin > Telephony > Extensions page's pool ranges (e.g. 7000-7999). Per-
-- extension assignment to a user stays on the frontend's local DB.users for
-- now — same known gap as roles/skills-per-person, not fixed here.
CREATE TABLE IF NOT EXISTS extension_pools (
  id SERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  start_ext TEXT NOT NULL,
  end_ext TEXT NOT NULL
);
ALTER TABLE did_assignments ADD COLUMN IF NOT EXISTS target_label TEXT;

-- Admin > Quality & WEM > Forecasts page. A planning group maps route paths
-- (queues + ACD skills + languages) to one forecast entity — queues/skills/
-- langs are plain string arrays here (like trunks.codecs), not FKs, since
-- the frontend already stores them as plain name lists, not ids.
CREATE TABLE IF NOT EXISTS planning_groups (
  id SERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  queues TEXT[] NOT NULL DEFAULT '{}',
  skills TEXT[] NOT NULL DEFAULT '{}',
  langs TEXT[] NOT NULL DEFAULT '{}'
);

-- service_goals.pgs is an int[] of planning_groups.id — Postgres doesn't
-- support a real FK constraint on an array column, so this is enforced
-- only by the frontend sync layer, same as other loosely-referenced
-- fields elsewhere in this schema (e.g. trunks.codecs).
CREATE TABLE IF NOT EXISTS service_goals (
  id SERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sl INTEGER NOT NULL DEFAULT 80,
  sls INTEGER NOT NULL DEFAULT 20,
  asa INTEGER NOT NULL DEFAULT 30,
  abn INTEGER NOT NULL DEFAULT 0,
  pgs INTEGER[] NOT NULL DEFAULT '{}'
);

-- data is the per-planning-group {vol, aht, days} breakdown, keyed by
-- planning_groups.id (as a JSON object, so the key is textual) — opaque
-- JSONB blob, same pattern as flows.graph / eval_forms.groups.
CREATE TABLE IF NOT EXISTS forecasts (
  id SERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  week TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Generated (ABM)',
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE(tenant_id, week)
);

-- Admin > Quality & WEM > Gamification page's metric profiles. m2/t2/w2 are
-- nullable/zero because the edit form's second metric slot is optional.
CREATE TABLE IF NOT EXISTS gamification_profiles (
  id SERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  applies_to TEXT NOT NULL DEFAULT 'Division',
  target TEXT,
  m1 TEXT NOT NULL,
  t1 INTEGER NOT NULL DEFAULT 0,
  w1 INTEGER NOT NULL DEFAULT 0,
  m2 TEXT,
  t2 INTEGER NOT NULL DEFAULT 0,
  w2 INTEGER NOT NULL DEFAULT 0,
  leaderboard BOOLEAN NOT NULL DEFAULT true,
  badges BOOLEAN NOT NULL DEFAULT true,
  challenges BOOLEAN NOT NULL DEFAULT true,
  reset_period TEXT NOT NULL DEFAULT 'Weekly',
  status TEXT NOT NULL DEFAULT 'Active'
);

-- Admin > Integrations > Integrations page's "Installed" tab. Scoped to
-- just that tab for now — Catalogue/Client Applications/Credentials stay
-- static display, no table needed for them yet.
-- Admin > Integrations > Integrations page's "Catalogue" tab — the
-- marketplace of integrations available to install. Previously a
-- hardcoded CATALOGUE_ITEMS array in the frontend (frontend/src/mcm/
-- scripts.ts); now real, admin-manageable rows. Same field set as
-- installed_integrations below (name/category/type/credentials/used_by)
-- since installing just copies those into a new installed_integrations
-- row — no description/icon/provider columns, since nothing in the
-- Catalogue UI displays or needs them. status supports retiring a
-- catalogue entry (PUT status='Deprecated') without losing the row's
-- history; UNIQUE(tenant_id, name) keeps the catalogue itself from
-- accumulating duplicate entries.
CREATE TABLE IF NOT EXISTS integration_catalogue (
  id SERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  category TEXT,
  type TEXT,
  credentials TEXT,
  used_by TEXT,
  status TEXT NOT NULL DEFAULT 'Active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name)
);

DROP TRIGGER IF EXISTS trg_integration_catalogue_touch ON integration_catalogue;
CREATE TRIGGER trg_integration_catalogue_touch BEFORE UPDATE ON integration_catalogue
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- Admin > Integrations > Integrations page's "Installed" tab. Client
-- Applications derives from here (see client_applications below);
-- Catalogue has its own table (integration_catalogue, above).
-- catalogue_id records which catalogue entry an install came from, when
-- it came from one — nullable + ON DELETE SET NULL so retiring a
-- catalogue entry never breaks an integration a tenant already installed
-- from it (manually-added installs, from the "+ Install Integration"
-- button rather than the Catalogue tab, simply have no catalogue_id).
CREATE TABLE IF NOT EXISTS installed_integrations (
  id SERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  category TEXT,
  type TEXT,
  credentials TEXT,
  used_by TEXT,
  division TEXT,
  status TEXT NOT NULL DEFAULT 'Active'
);
ALTER TABLE installed_integrations ADD COLUMN IF NOT EXISTS catalogue_id INTEGER REFERENCES integration_catalogue(id) ON DELETE SET NULL;
-- Duplicate prevention: the same integration can't be installed twice for
-- one tenant. A unique index (not a table-level UNIQUE(...) clause) so it
-- can be added idempotently to a table that may already exist — Postgres
-- has no ADD CONSTRAINT IF NOT EXISTS for this.
CREATE UNIQUE INDEX IF NOT EXISTS idx_installed_integrations_tenant_name ON installed_integrations(tenant_id, name);

-- Admin > Integrations > Integrations page's "Credentials" tab. No secret
-- value column on purpose — the page's own text says credentials are
-- write-only and never displayed after saving, so the entered value is
-- never sent to or stored by the backend either, only this metadata.
CREATE TABLE IF NOT EXISTS integration_credentials (
  id SERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  integration_name TEXT,
  rotated_at DATE
);
-- Every read of this table filters by tenant_id (see auth.py's guard +
-- the generic registry), but unlike its sibling tables it had no index
-- covering that column — fine at demo scale, a sequential scan per
-- request in production.
CREATE INDEX IF NOT EXISTS idx_integration_credentials_tenant ON integration_credentials(tenant_id);

-- Admin > Integrations > Integrations page's "Client Applications" tab.
-- Previously computed purely in the browser by filtering installed
-- integrations whose free-text `type` column contained "client
-- application" — fragile, since any edit/typo to that column silently
-- changed which rows appeared here with no record of the fact. This
-- makes membership an explicit, queryable relationship instead of a
-- string match: one row per installed_integrations row that currently
-- qualifies, kept in sync by backend/client_apps.py's reconcile step on
-- every read rather than duplicating name/type/status data that already
-- lives on installed_integrations.
-- source distinguishes how a row got here: 'auto' rows are pure derived
-- state from installed_integrations.type and can be pruned by the
-- reconcile step the moment that type stops matching; 'manual' rows came
-- from POST /api/client-applications registering an integration as a
-- client application "independent of what its free-text type says" (see
-- client_apps.py's register_client_app) and must survive reconcile even
-- though nothing about the parent row's type says so.
CREATE TABLE IF NOT EXISTS client_applications (
  id SERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  installed_integration_id INTEGER NOT NULL REFERENCES installed_integrations(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (installed_integration_id)
);
ALTER TABLE client_applications ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'auto';
-- Same reasoning as idx_integration_credentials_tenant: every query here
-- is tenant-filtered (list + both reconcile statements in client_apps.py).
CREATE INDEX IF NOT EXISTS idx_client_applications_tenant ON client_applications(tenant_id);

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
  active BOOLEAN NOT NULL DEFAULT false,
  division TEXT,
  members INTEGER[] NOT NULL DEFAULT '{}',
  emergency_contacts JSONB NOT NULL DEFAULT '[]'::jsonb,
  notification_rules JSONB NOT NULL DEFAULT '[]'::jsonb,
  escalation_tiers JSONB NOT NULL DEFAULT '[]'::jsonb
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_emergency_groups_tenant_name ON emergency_groups (tenant_id, lower(name));

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

-- Admin > Quality & WEM > Evaluation Forms — "Perform Evaluation": one row
-- per scored interaction. answers is keyed by question id (JSONB), matching
-- eval_forms.groups[].questions[].id at scoring time. form_id/interaction_id/
-- agent_id/evaluator_id are all ON DELETE SET NULL rather than CASCADE — a
-- later-deleted form, interaction or user shouldn't erase historical scoring
-- records, only the row's forwarding reference to it.
CREATE TABLE IF NOT EXISTS evals (
  id SERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  form_id INTEGER REFERENCES eval_forms(id) ON DELETE SET NULL,
  interaction_id UUID REFERENCES interactions(id) ON DELETE SET NULL,
  agent_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  evaluator_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  answers JSONB NOT NULL DEFAULT '{}'::jsonb,
  pct INTEGER NOT NULL DEFAULT 0,
  critical_fail BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_evals_tenant_created ON evals(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_evals_form ON evals(form_id);

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
CREATE UNIQUE INDEX IF NOT EXISTS ux_schedule_groups_tenant_name ON schedule_groups (tenant_id, lower(name));

-- call_routes is defined earlier in this file, before schedule_groups
-- existed to reference.
ALTER TABLE call_routes ADD COLUMN IF NOT EXISTS schedule_id INTEGER REFERENCES schedule_groups(id);

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
-- Authorized Organizations — inter-tenant trust relationships.
-- Each row is a trust granting (or revoking) another org's
-- access to specific roles and divisions inside this tenant.
-- ============================================================

CREATE TABLE IF NOT EXISTS auth_org_trusts (
  id SERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  org_name TEXT NOT NULL,
  org_id TEXT,                           -- external org UUID (informational)
  domain TEXT,
  relationship TEXT NOT NULL DEFAULT 'Trustee',  -- 'Owner' | 'Trustee' | 'Trustor'
  scope_roles TEXT[] NOT NULL DEFAULT '{}',
  divisions TEXT[] NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'Active',         -- 'Active' | 'Owner' | 'Revoked' | 'Expiring soon'
  expires_at DATE,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_auth_org_trusts_tenant ON auth_org_trusts(tenant_id);

DROP TRIGGER IF EXISTS trg_auth_org_trusts_touch ON auth_org_trusts;
CREATE TRIGGER trg_auth_org_trusts_touch BEFORE UPDATE ON auth_org_trusts
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ============================================================
-- Alert Rules — threshold-based rules that fire notifications
-- when live KPIs exceed configured limits. Evaluated by the
-- frontend timer; the backend stores and syncs the definitions.
-- ============================================================

CREATE TABLE IF NOT EXISTS alert_rules (
  id SERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  metric TEXT NOT NULL,           -- 'Interactions waiting' | 'Longest wait (min)' | etc.
  cond TEXT NOT NULL DEFAULT '>',  -- '>' | '<' | '>=' | '<='
  threshold REAL NOT NULL DEFAULT 0,
  dur INTEGER NOT NULL DEFAULT 0,  -- minutes the condition must hold (0 = immediate)
  notify TEXT[] NOT NULL DEFAULT '{}',  -- user IDs to alert
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_alert_rules_tenant ON alert_rules(tenant_id);

DROP TRIGGER IF EXISTS trg_alert_rules_touch ON alert_rules;
CREATE TRIGGER trg_alert_rules_touch BEFORE UPDATE ON alert_rules
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ============================================================
-- Adherence / WFM — activity codes, management units, and
-- schedule data backing the Workforce Management module.
-- ============================================================

CREATE TABLE IF NOT EXISTS activity_codes (
  id SERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'On Queue',  -- On Queue | Break | Meal | Meeting | Training | Time Off
  paid BOOLEAN NOT NULL DEFAULT true,
  adherence_rule TEXT NOT NULL DEFAULT 'Adherent when On Queue',
  adherence TEXT,
  enabled BOOLEAN NOT NULL DEFAULT true
);
CREATE INDEX IF NOT EXISTS idx_activity_codes_tenant ON activity_codes(tenant_id);
-- backfill: ensure both column sets exist regardless of which CREATE ran first
ALTER TABLE activity_codes ADD COLUMN IF NOT EXISTS adherence TEXT;
ALTER TABLE activity_codes ADD COLUMN IF NOT EXISTS adherence_rule TEXT NOT NULL DEFAULT 'Adherent when On Queue';
ALTER TABLE activity_codes ADD COLUMN IF NOT EXISTS enabled BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE IF NOT EXISTS management_units (
  id SERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  agents TEXT[] NOT NULL DEFAULT '{}'  -- user IDs assigned to this MU
);
CREATE INDEX IF NOT EXISTS idx_management_units_tenant ON management_units(tenant_id);

CREATE TABLE IF NOT EXISTS wfm_schedules (
  id SERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  week TEXT NOT NULL,               -- ISO week label e.g. '2026-W34'
  status TEXT NOT NULL DEFAULT 'Draft',  -- 'Draft' | 'Published'
  entries JSONB NOT NULL DEFAULT '{}'::jsonb,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_wfm_schedules_tenant ON wfm_schedules(tenant_id);
-- backfill: ensure both column sets exist regardless of which CREATE ran first
ALTER TABLE wfm_schedules ADD COLUMN IF NOT EXISTS entries JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE wfm_schedules ADD COLUMN IF NOT EXISTS data JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE wfm_schedules ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE wfm_schedules ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

DROP TRIGGER IF EXISTS trg_wfm_schedules_touch ON wfm_schedules;
CREATE TRIGGER trg_wfm_schedules_touch BEFORE UPDATE ON wfm_schedules
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
-- Canned Responses Module
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

-- ============================================================
-- Prompts Module
CREATE TABLE IF NOT EXISTS prompts (
  id SERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  tts TEXT NOT NULL DEFAULT '',
  lang TEXT NOT NULL DEFAULT 'en-GB',
  audio_name TEXT,
  audio_data TEXT,
  audio_mime TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_prompts_tenant ON prompts(tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS ux_prompts_tenant_name ON prompts (tenant_id, lower(name));

DROP TRIGGER IF EXISTS trg_prompts_touch ON prompts;
CREATE TRIGGER trg_prompts_touch BEFORE UPDATE ON prompts
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ============================================================
-- Phone Base Settings Module
CREATE TABLE IF NOT EXISTS base_settings (
  id SERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  model TEXT NOT NULL DEFAULT '',
  codec TEXT NOT NULL DEFAULT '',
  rtp_port INTEGER NOT NULL DEFAULT 16384,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_base_settings_tenant ON base_settings(tenant_id);

DROP TRIGGER IF EXISTS trg_base_settings_touch ON base_settings;
CREATE TRIGGER trg_base_settings_touch BEFORE UPDATE ON base_settings
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ============================================================
-- Phone Management Module
CREATE TABLE IF NOT EXISTS phones (
  id SERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  base_name TEXT NOT NULL DEFAULT '',
  site_name TEXT NOT NULL DEFAULT '',
  assigned_user TEXT DEFAULT '',
  mac TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'Not registered',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_phones_tenant ON phones(tenant_id);

DROP TRIGGER IF EXISTS trg_phones_touch ON phones;
CREATE TRIGGER trg_phones_touch BEFORE UPDATE ON phones
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ============================================================
-- Number Plans Module (child of Telephony Sites)
CREATE TABLE IF NOT EXISTS number_plans (
  id SERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  site_name TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL,
  match_type TEXT NOT NULL DEFAULT 'Regex',
  match_spec JSONB NOT NULL DEFAULT '{}',
  classification TEXT NOT NULL DEFAULT 'National',
  normalisation TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_number_plans_tenant_site ON number_plans(tenant_id, site_name);

DROP TRIGGER IF EXISTS trg_number_plans_touch ON number_plans;
CREATE TRIGGER trg_number_plans_touch BEFORE UPDATE ON number_plans
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ============================================================
-- Outbound Routes Module (child of Telephony Sites)
CREATE TABLE IF NOT EXISTS outbound_routes (
  id SERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  site_name TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL,
  classifications TEXT[] NOT NULL DEFAULT '{}',
  trunk_ids TEXT[] NOT NULL DEFAULT '{}',
  distribution TEXT NOT NULL DEFAULT 'Sequential',
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_outbound_routes_tenant_site ON outbound_routes(tenant_id, site_name);

DROP TRIGGER IF EXISTS trg_outbound_routes_touch ON outbound_routes;
CREATE TRIGGER trg_outbound_routes_touch BEFORE UPDATE ON outbound_routes
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ============================================================
-- Message Channels Module (Message Routing)
CREATE TABLE IF NOT EXISTS message_channels (
  id SERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  channel_type TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  config JSONB NOT NULL DEFAULT '{}',
  queue_id TEXT DEFAULT '',
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_message_channels_tenant ON message_channels(tenant_id, channel_type);

DROP TRIGGER IF EXISTS trg_message_channels_touch ON message_channels;
CREATE TRIGGER trg_message_channels_touch BEFORE UPDATE ON message_channels
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- Admin > Telephony > Phone Base Settings.
CREATE TABLE IF NOT EXISTS phone_base_settings (
  id SERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  model TEXT,
  codec TEXT,
  port INTEGER NOT NULL DEFAULT 16384
);

-- Admin > Telephony > Carrier Connections (BYOC). kind/direction/term/auth/
-- codecs/byocSid/policySid/note vary a lot by carrier kind, so they live in
-- config (JSONB) rather than one column each — same pattern as queues.config.
CREATE TABLE IF NOT EXISTS byoc_trunks (
  id SERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 100,
  status TEXT NOT NULL DEFAULT 'Active',
  locked BOOLEAN NOT NULL DEFAULT false,
  config JSONB NOT NULL DEFAULT '{}'::jsonb
);

-- Admin > Outbound > Campaigns page edits a richer object than acd.py's
-- campaigns table (id/tenant_id/name only, used by the dial/monitor
-- endpoints) had — these are purely additive. queue/script/list/dnc
-- reference the local queue/script/contact-list/DNC-list ids as plain
-- text, not real FKs — same simplification as Call Routes' flow reference.
-- stats/log are simulated live-dialer runtime state, not admin-edited
-- config, so they aren't persisted here — only what saveCamp() edits is.
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS division TEXT;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS mode TEXT NOT NULL DEFAULT 'Progressive';
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS queue_ref TEXT;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS script_ref TEXT;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS list_ref TEXT;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS dnc_ref TEXT;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS caller_id TEXT;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS caller_name TEXT;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS pace REAL NOT NULL DEFAULT 1.0;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS max_attempts INTEGER NOT NULL DEFAULT 3;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'Off';

-- ============================================================
-- Digital Certificates Module — backs frontend/src/mcm/certs-redesign.ts's
-- Telephony > Digital Certificates page (see backend/certs.py for the
-- /api/certs endpoints). status ('Valid' | 'Expiring' | 'Expired') is
-- deliberately NOT a stored column — the page's own "Expiry Monitor" tab
-- already shows this as a live days-remaining calculation, so storing a
-- status string here would just go stale the moment expires_at passes a
-- threshold without anything re-writing the row. certs.py computes it from
-- expires_at/alert_before_days on every read instead, same as the frontend
-- fallback data does.
CREATE TABLE IF NOT EXISTS certificates (
  id TEXT PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  purpose TEXT NOT NULL DEFAULT 'BYOC trunk',
  issued_to TEXT NOT NULL DEFAULT '',
  issuer TEXT NOT NULL DEFAULT '',
  division TEXT NOT NULL DEFAULT '',      -- '' = not division-scoped (root/global CAs), else d_home/d_ret/d_dig/d_col/d_man
  valid_from DATE,
  expires_at DATE NOT NULL,
  alert_before_days INTEGER NOT NULL DEFAULT 30,
  email_alert BOOLEAN NOT NULL DEFAULT true,
  auto_renew BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_certificates_tenant_expires ON certificates(tenant_id, expires_at);

DROP TRIGGER IF EXISTS trg_certificates_touch ON certificates;
CREATE TRIGGER trg_certificates_touch BEFORE UPDATE ON certificates
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ============================================================
-- Admin > Quality & WEM > Schedules (WFM) — a 5-sub-tab module
-- (Schedules/Work Plans/Activity Codes/Time Off/Shift Trades), each its
-- own entity here. agent_ref/from_ref/to_ref store the local user id as
-- plain text (not a FK) — same simplification used throughout for
-- cross-entity references the admin UI only ever displays, not queries.
-- ============================================================

CREATE TABLE IF NOT EXISTS work_plans (
  id SERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  days TEXT[] NOT NULL DEFAULT '{}',
  shift_len INTEGER NOT NULL DEFAULT 8,
  flex_from TEXT,
  flex_to TEXT,
  paid INTEGER,
  agents TEXT[] NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS activity_codes (
  id SERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  category TEXT,
  paid BOOLEAN NOT NULL DEFAULT false,
  adherence TEXT
);

CREATE TABLE IF NOT EXISTS time_off_requests (
  id SERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  agent_ref TEXT,
  code TEXT,
  dates TEXT,
  day TEXT,
  status TEXT NOT NULL DEFAULT 'Pending'
);

CREATE TABLE IF NOT EXISTS shift_trades (
  id SERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  from_ref TEXT,
  to_ref TEXT,
  day TEXT,
  status TEXT NOT NULL DEFAULT 'Pending'
);

-- The generated week schedule itself (genSchedule/pubSchedule/delSchedule).
-- entries (agent -> day -> shift-or-off) is exactly the shape the frontend
-- already computes locally, so it round-trips through data (JSONB) whole
-- rather than being normalised — same pattern as flows.graph.
CREATE TABLE IF NOT EXISTS wfm_schedules (
  id SERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  week TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Draft',
  data JSONB NOT NULL DEFAULT '{}'::jsonb
);

-- ============================================================
-- Admin > Quality & WEM > Calibrations — comparing multiple evaluators'
-- scores against the same interaction/eval-form to check scoring
-- consistency. No local seed/functions existed for this page before —
-- built alongside its backend connection, not just wired to one.
-- ============================================================
CREATE TABLE IF NOT EXISTS calibrations (
  id SERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  form_ref TEXT,
  interaction_ref TEXT,
  division TEXT NOT NULL DEFAULT '',    -- '' = not division-scoped, else d_home/d_ret/d_dig/d_col/d_man
  status TEXT NOT NULL DEFAULT 'In Progress',
  evaluators JSONB NOT NULL DEFAULT '[]'::jsonb,
  notes TEXT,
  due_date DATE,
  hide_scores_until_complete BOOLEAN NOT NULL DEFAULT true,
  include_agent_self_assessment BOOLEAN NOT NULL DEFAULT false,
  notify_evaluators_by_email BOOLEAN NOT NULL DEFAULT true
);
ALTER TABLE calibrations ADD COLUMN IF NOT EXISTS division TEXT NOT NULL DEFAULT '';
ALTER TABLE calibrations ADD COLUMN IF NOT EXISTS due_date DATE;
ALTER TABLE calibrations ADD COLUMN IF NOT EXISTS hide_scores_until_complete BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE calibrations ADD COLUMN IF NOT EXISTS include_agent_self_assessment BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE calibrations ADD COLUMN IF NOT EXISTS notify_evaluators_by_email BOOLEAN NOT NULL DEFAULT true;

-- ============================================================
-- Admin > Integrations > Bot Connectors — same story as Calibrations: no
-- local functions existed, built alongside the backend connection.
-- ============================================================
CREATE TABLE IF NOT EXISTS bot_connectors (
  id SERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  platform TEXT NOT NULL DEFAULT 'Custom',
  status TEXT NOT NULL DEFAULT 'Disconnected',
  webhook_url TEXT,
  notes TEXT
);
-- status is written only by the connect/disconnect/test endpoints in
-- backend/botconnectors.py, never accepted from the client, so these
-- columns record the outcome of those actions.
ALTER TABLE bot_connectors ADD COLUMN IF NOT EXISTS last_connected_at TIMESTAMPTZ;
ALTER TABLE bot_connectors ADD COLUMN IF NOT EXISTS last_error TEXT NOT NULL DEFAULT '';
ALTER TABLE bot_connectors ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE bot_connectors ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
-- Duplicate prevention at the database level, case-insensitive to match
-- the app-level pre-check — same pattern as idx_data_actions_tenant_name_ci.
CREATE UNIQUE INDEX IF NOT EXISTS idx_bot_connectors_tenant_name_ci ON bot_connectors(tenant_id, LOWER(name));
CREATE INDEX IF NOT EXISTS idx_bot_connectors_tenant ON bot_connectors(tenant_id);

DROP TRIGGER IF EXISTS trg_bot_connectors_touch ON bot_connectors;
CREATE TRIGGER trg_bot_connectors_touch BEFORE UPDATE ON bot_connectors
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- bot_connector_events (removed). It logged connect/disconnect/test
-- attempts to back a "Connection History" tab. That tab does not exist in
-- the Bot Connectors prototype — the page has exactly three sections
-- (Bots, Intents, Test Utterances) — so once the page was aligned to the
-- prototype nothing read the table any more: it was written on every
-- action and never displayed. The durable outcome of an attempt is
-- already on the connector row itself (status / last_connected_at /
-- last_error), which is what the Status column actually shows, so the log
-- was redundant rather than merely unused. Dropped here (idempotently, so
-- both a fresh database and an already-migrated one converge on the same
-- schema) rather than left as a table nothing maintains.
DROP TABLE IF EXISTS bot_connector_events;

-- Columns the Bot Connectors list actually displays (Bot / Provider /
-- Language / Intents / Channels / Confidence threshold / Status). Only
-- `platform` ("Provider") and `name` existed before, so the rest of the
-- page's columns had nothing behind them. `lifecycle` is the Live /
-- Training / Retired value shown in the Status column and driven by the
-- Status filter; it is distinct from `status`, which tracks whether the
-- connector is currently Connected (owned by the connect/disconnect/test
-- endpoints) — a bot can be Live but momentarily Disconnected.
ALTER TABLE bot_connectors ADD COLUMN IF NOT EXISTS language TEXT NOT NULL DEFAULT 'en-GB';
ALTER TABLE bot_connectors ADD COLUMN IF NOT EXISTS channels TEXT NOT NULL DEFAULT '';
ALTER TABLE bot_connectors ADD COLUMN IF NOT EXISTS confidence_threshold NUMERIC(3,2) NOT NULL DEFAULT 0.70
  CHECK (confidence_threshold >= 0 AND confidence_threshold <= 1);
ALTER TABLE bot_connectors ADD COLUMN IF NOT EXISTS division TEXT NOT NULL DEFAULT '';
ALTER TABLE bot_connectors ADD COLUMN IF NOT EXISTS lifecycle TEXT NOT NULL DEFAULT 'Training';

-- Intents tab. One row per intent a connector recognises; the tab's
-- "Utterances" column is a COUNT over bot_intent_utterances rather than a
-- stored number, so it can never disagree with the utterances actually
-- held. Intents belong to their connector (CASCADE): an intent has no
-- meaning once the bot it belongs to is gone.
CREATE TABLE IF NOT EXISTS bot_intents (
  id SERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  bot_connector_id INTEGER NOT NULL REFERENCES bot_connectors(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  confidence NUMERIC(3,2) NOT NULL DEFAULT 0.90
    CHECK (confidence >= 0 AND confidence <= 1),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (bot_connector_id, name)
);
CREATE INDEX IF NOT EXISTS idx_bot_intents_tenant ON bot_intents(tenant_id);
CREATE INDEX IF NOT EXISTS idx_bot_intents_connector ON bot_intents(bot_connector_id, name);

DROP TRIGGER IF EXISTS trg_bot_intents_touch ON bot_intents;
CREATE TRIGGER trg_bot_intents_touch BEFORE UPDATE ON bot_intents
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- Training phrases behind each intent. These are what the Test Utterances
-- tab's "Match intent" actually matches against server-side — without
-- them that tab could only ever be a frontend simulation.
CREATE TABLE IF NOT EXISTS bot_intent_utterances (
  id SERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  bot_intent_id INTEGER NOT NULL REFERENCES bot_intents(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (bot_intent_id, text)
);
CREATE INDEX IF NOT EXISTS idx_bot_intent_utterances_intent ON bot_intent_utterances(bot_intent_id);
CREATE INDEX IF NOT EXISTS idx_bot_intent_utterances_tenant ON bot_intent_utterances(tenant_id);

-- Contact Lists Module — backs frontend/src/mcm/contactlists-redesign.ts's
-- Outbound > Contact Lists page (see backend/contactlists.py for the
-- /api/contactlists endpoints). Each list has its own arbitrary column set
-- (cols), so per-contact field values live in a JSONB `data` blob keyed by
-- those column names rather than fixed columns — same "schema owned by the
-- list, not the table" shape scripts.ts's original in-memory DB.contactLists
-- used (l.cols / ct.data).
CREATE TABLE IF NOT EXISTS contact_lists (
  id TEXT PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  division TEXT NOT NULL DEFAULT '',      -- '' = not division-scoped, else d_home/d_ret/d_dig/d_col/d_man
  cols TEXT[] NOT NULL DEFAULT ARRAY['FirstName','LastName','Phone'],
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_contact_lists_tenant ON contact_lists(tenant_id);

DROP TRIGGER IF EXISTS trg_contact_lists_touch ON contact_lists;
CREATE TRIGGER trg_contact_lists_touch BEFORE UPDATE ON contact_lists
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TABLE IF NOT EXISTS contacts (
  id TEXT PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  list_id TEXT NOT NULL REFERENCES contact_lists(id) ON DELETE CASCADE,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'Not attempted',
  attempts INTEGER NOT NULL DEFAULT 0,
  last_result TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_contacts_list ON contacts(list_id);
CREATE INDEX IF NOT EXISTS idx_contacts_tenant ON contacts(tenant_id);

DROP TRIGGER IF EXISTS trg_contacts_touch ON contacts;
CREATE TRIGGER trg_contacts_touch BEFORE UPDATE ON contacts
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ============================================================
-- Data Actions Module — backs frontend/src/mcm/dataact-redesign.ts's
-- Integrations > Data Actions page (see backend/dataact.py for the
-- /api/dataact endpoints). avg_latency_ms/status/last_error are written by
-- the Test Action endpoint (a deterministic simulated call — this prototype
-- has no real Salesforce/ServiceNow/web-service backends to reach, and a
-- backend that made outbound requests to a user-editable endpoint field
-- would be an SSRF risk), not hand-edited through the drawer.
CREATE TABLE IF NOT EXISTS data_actions (
  id TEXT PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  integration TEXT NOT NULL DEFAULT 'Web Services',   -- Salesforce | ServiceNow | Web Services
  method TEXT NOT NULL DEFAULT 'GET',
  endpoint TEXT NOT NULL DEFAULT '',
  contract TEXT NOT NULL DEFAULT '',                  -- short request → response summary, e.g. 'ani → tier, name'
  division TEXT NOT NULL DEFAULT '',                  -- '' = not division-scoped, else d_home/d_ret/d_dig/d_col/d_man
  avg_latency_ms INTEGER,
  status TEXT NOT NULL DEFAULT 'Draft',               -- Draft | Published | Slow | Failing
  last_error TEXT NOT NULL DEFAULT '',
  last_tested_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_data_actions_tenant ON data_actions(tenant_id);
-- Duplicate prevention at the DB level, not just the app's SELECT-then-
-- INSERT pre-check in dataact.py (which is still kept, for a fast/friendly
-- message — this index is the race-condition-proof backstop, same pattern
-- as installed_integrations' idx_installed_integrations_tenant_name).
-- Case-insensitive to match that pre-check's LOWER(name) comparison.
CREATE UNIQUE INDEX IF NOT EXISTS idx_data_actions_tenant_name_ci ON data_actions(tenant_id, LOWER(name));

DROP TRIGGER IF EXISTS trg_data_actions_touch ON data_actions;
CREATE TRIGGER trg_data_actions_touch BEFORE UPDATE ON data_actions
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- Data Actions page's "Run History" tab — previously two hardcoded example
-- rows in scripts.ts's static TT.dataact['Run History'], unrelated to any
-- real data_actions row. One row per real Test Action invocation (see
-- dataact.py's test_action), so the tab reflects what was actually run
-- instead of two permanently-fake log lines. Deliberately NOT a FK-only
-- table with no snapshot: data_action_id is nullable + ON DELETE SET NULL
-- so a run's history survives its parent action being deleted (matching
-- installed_integrations.catalogue_id's same reasoning) — action_name is
-- captured at run time for exactly that case, so the log line still reads
-- sensibly after the action is gone.
CREATE TABLE IF NOT EXISTS data_action_runs (
  id SERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  data_action_id TEXT REFERENCES data_actions(id) ON DELETE SET NULL,
  action_name TEXT NOT NULL,
  duration_ms INTEGER,
  result TEXT NOT NULL,               -- e.g. '200 OK', 'Timeout retry', 'Connection refused (503)'
  ran_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_data_action_runs_tenant ON data_action_runs(tenant_id, ran_at DESC);
-- Run History also records *why* a run happened, so a run triggered by the
-- Actions drawer's "Test Action" and one triggered from the Test tab are
-- distinguishable in the log rather than being indistinguishable rows.
ALTER TABLE data_action_runs ADD COLUMN IF NOT EXISTS trigger_source TEXT NOT NULL DEFAULT 'test';

-- Data Actions page's "Contracts" tab. The freeform data_actions.contract
-- column ('subject, desc → caseId') is what the Create/Edit drawer lets a
-- user type, but the Contracts tab needs it *structured* — one row per
-- field, with its direction — and that structure was previously computed
-- in the browser and never persisted, so the contract breakdown existed
-- only in the DOM. These rows are the persisted structured form, derived
-- server-side by dataact.py's _sync_contract_fields() on every data-action
-- create/update, so the string a user types and the structured rows can
-- never drift apart. Contracts belong to their action (ON DELETE CASCADE):
-- unlike run history, a contract has no meaning once its action is gone.
CREATE TABLE IF NOT EXISTS data_action_contracts (
  id SERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  data_action_id TEXT NOT NULL REFERENCES data_actions(id) ON DELETE CASCADE,
  direction TEXT NOT NULL CHECK (direction IN ('input', 'output')),
  field_name TEXT NOT NULL,
  field_type TEXT NOT NULL DEFAULT 'string',
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (data_action_id, direction, field_name)
);
CREATE INDEX IF NOT EXISTS idx_data_action_contracts_tenant ON data_action_contracts(tenant_id);
CREATE INDEX IF NOT EXISTS idx_data_action_contracts_action ON data_action_contracts(data_action_id, direction, position);

DROP TRIGGER IF EXISTS trg_data_action_contracts_touch ON data_action_contracts;
CREATE TRIGGER trg_data_action_contracts_touch BEFORE UPDATE ON data_action_contracts
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ============================================================
-- Admin > Telephony > Sites. plans/routes stay JSONB blobs — same
-- pattern as flows.graph and eval_forms.groups — rather than a
-- normalised schema, since the Number Plans / Outbound Routes pages
-- edit them as a nested list within the site, not as their own entities.
-- ============================================================
CREATE TABLE IF NOT EXISTS sites (
  id SERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  location TEXT,
  tz TEXT,
  media TEXT NOT NULL DEFAULT 'Cloud',    -- Cloud | Premises — immutable after creation (frontend-enforced)
  is_default BOOLEAN NOT NULL DEFAULT false,
  edge_group TEXT,
  plans JSONB NOT NULL DEFAULT '[]'::jsonb,
  routes JSONB NOT NULL DEFAULT '[]'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_sites_tenant ON sites(tenant_id);

-- ============================================================
-- Admin > Contact Center > Wrap-up Codes — the code catalogue (not the
-- per-interaction wrapup text field on interactions, a separate thing).
-- ============================================================
CREATE TABLE IF NOT EXISTS wrapup_codes (
  id SERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT
);
CREATE INDEX IF NOT EXISTS idx_wrapup_codes_tenant ON wrapup_codes(tenant_id);

-- ============================================================
-- Admin > Contact Center > Utilization — one settings row per tenant
-- (not a list entity), so it's a hand-written GET/PUT in app.py rather
-- than the generic list-CRUD registry, same pattern as /api/subscription.
-- ============================================================
CREATE TABLE IF NOT EXISTS utilization_settings (
  tenant_id UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- DNC Lists Module — backs frontend/src/mcm/dnclists-redesign.ts's
-- Outbound > DNC Lists page (see backend/dnclists.py for the
-- /api/dnclists endpoints). Numbers live in their own table (not a TEXT[]
-- column on dnc_lists) so a single number can be looked up across every
-- list in the tenant in one indexed query — see dncNumberLookup() /
-- GET /api/dnclists/lookup — the same job the page's own "Number Lookup"
-- drawer already did client-side over the in-memory DB.dncLists array.
CREATE TABLE IF NOT EXISTS dnc_lists (
  id TEXT PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_dnc_lists_tenant ON dnc_lists(tenant_id);

DROP TRIGGER IF EXISTS trg_dnc_lists_touch ON dnc_lists;
CREATE TRIGGER trg_dnc_lists_touch BEFORE UPDATE ON dnc_lists
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TABLE IF NOT EXISTS dnc_numbers (
  id TEXT PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  list_id TEXT NOT NULL REFERENCES dnc_lists(id) ON DELETE CASCADE,
  phone TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_dnc_numbers_list_phone ON dnc_numbers(list_id, phone);
CREATE INDEX IF NOT EXISTS idx_dnc_numbers_tenant_phone ON dnc_numbers(tenant_id, phone);

-- ============================================================
-- Integrations Phase 1 — real Salesforce OAuth connection (see
-- backend/salesforce_oauth.py / backend/salesforce_client.py). Backs the
-- Installed tab's Connect/Disconnect/Test Connection controls on the
-- Salesforce CTI row, and dataact.py's real execution branch for the
-- CRM_Lookup_Customer data action. Deliberately two NEW tables rather than
-- any change to installed_integrations/integration_credentials/
-- data_actions/data_action_runs — none of those needed a schema change.
-- ============================================================

-- One row per installed Salesforce connection's OAuth tokens. Tokens are
-- Fernet-encrypted before storage (see salesforce_oauth.py's _encrypt/
-- _decrypt) — this table never holds a plaintext access/refresh token,
-- unlike sso_providers.client_secret above, which the schema comment on
-- that table already admits is a prototype shortcut not to be repeated.
-- 1:1 with installed_integrations via the UNIQUE constraint — reconnecting
-- updates the existing row rather than accumulating history.
CREATE TABLE IF NOT EXISTS salesforce_connections (
  id SERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  installed_integration_id INTEGER NOT NULL REFERENCES installed_integrations(id) ON DELETE CASCADE,
  access_token_encrypted TEXT,
  refresh_token_encrypted TEXT,
  instance_url TEXT,
  token_type TEXT,
  scope TEXT,
  expires_at TIMESTAMPTZ,
  -- Not Connected | Connecting | Connected | Authentication Failed |
  -- Token Expired | Disconnected — set only by salesforce_oauth.py's route
  -- handlers, never client-writable (this table has no resources.py
  -- registry entry, so it isn't reachable through the generic CRUD routes).
  connection_status TEXT NOT NULL DEFAULT 'Not Connected',
  last_error TEXT NOT NULL DEFAULT '',
  connected_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (installed_integration_id)
);
CREATE INDEX IF NOT EXISTS idx_salesforce_connections_tenant ON salesforce_connections(tenant_id);

DROP TRIGGER IF EXISTS trg_salesforce_connections_touch ON salesforce_connections;
CREATE TRIGGER trg_salesforce_connections_touch BEFORE UPDATE ON salesforce_connections
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- Short-lived OAuth CSRF state, mirroring sso_states above exactly (same
-- single-use-then-delete pattern). redirect_uri is the Genesis frontend
-- page to bounce back to once the callback finishes — Salesforce's
-- redirect lands on this backend with no bearer token attached, so tenant/
-- integration identity for the callback comes from this row, never from
-- client-supplied input.
CREATE TABLE IF NOT EXISTS salesforce_oauth_states (
  state TEXT PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  installed_integration_id INTEGER NOT NULL REFERENCES installed_integrations(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id),
  redirect_uri TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);
