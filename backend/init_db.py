"""
Schema setup + a small set of reference/definition data, run at import time
(see app.py). The Render Postgres instance starts empty — nothing here has
ever run schema.sql against it — so every query 500s until tables exist.
schema.sql is all CREATE TABLE IF NOT EXISTS / idempotent DDL, safe to run
on every boot regardless of what's already there.

The inserts below are a mix of two different things, not one uniform "seed
step": some (roles, divisions, licenses, users, ...) are guarded by a
COUNT-empty check and only ever run once, on a genuinely fresh database;
others (integration_catalogue, canned_responses, certificates, contact
lists, ...) are static reference/definition data — the kind of thing a real
deployment ships with, like a product catalogue — and insert unconditionally
with ON CONFLICT DO NOTHING every boot, which is fine precisely because they
are definitions, not per-tenant business records: no Data Action, no Bot
Connector, no installed integration, no credential, and no run-history row
is ever created here. Every one of those starts genuinely empty and is only
ever populated by a real, explicit user action through the app's own API.
"""

import os
import re
from datetime import datetime
from werkzeug.security import generate_password_hash
from db import get_db

SCHEMA_PATH = os.path.join(os.path.dirname(__file__), '..', 'database', 'schema.sql')

# Same category → label map as backend/canned.py and the frontend's
# CANNED_CATEGORIES — kept in three places because canned.py needs it at
# request time, this module needs it once at seed time, and the frontend
# needs it in the browser; not worth a shared-import for three static dicts.
CANNED_CATEGORY_LABELS = {
    'greetings': 'Greetings',
    'billing': 'Billing',
    'technical': 'Technical Support',
    'escalation': 'Escalation',
    'closing': 'Closing',
    'general': 'General',
}

_SUBSTITUTION_RE = re.compile(r'\{\{\s*([^}]+?)\s*\}\}')


def _extract_substitution_fields(body):
    seen = []
    for m in _SUBSTITUTION_RE.finditer(body or ''):
        token = m.group(1).strip()
        if token and token not in seen:
            seen.append(token)
    return seen

# All seeded demo accounts share this password so they stay loggable now
# that /api/auth/login actually checks one — fine for a demo tenant, not a
# pattern to keep once real users outnumber seed data.
DEMO_PASSWORD_HASH = generate_password_hash('demo1234')

DIVISIONS = [
    ('d_home', 'Home', 'Default division — cannot be deleted', True),
    ('d_ret', 'UK Retail', 'Retail contact centre', False),
    ('d_dig', 'UK Digital', 'Digital / messaging teams', False),
    ('d_col', 'UK Collections', 'Collections & recoveries', False),
    ('d_man', 'Partner — Manila', 'BPO partner site', False),
]

LICENSES = [
    ('CX 1', 'CX 1 — Voice', 40, 75),
    ('CX 2', 'CX 2 — Digital', 60, 115),
    ('CX 3', 'CX 3 — WEM', 25, 155),
    ('CX 4', 'CX 4 — AI', 10, 240),
    ('Communicate', 'Communicate', 50, 18),
]

# Admin > Integrations > Integrations page's "Catalogue" tab — same 4
# entries the frontend's now-removed CATALOGUE_ITEMS array used to
# hardcode (frontend/src/mcm/scripts.ts), seeded once so the tab has real
# data on first boot instead of starting empty.
INTEGRATION_CATALOGUE = [
    ('Salesforce CTI', 'CRM', 'Client application', 'OAuth', 'Agent UI'),
    ('Microsoft Teams', 'UC', 'Directory presence sync', 'OAuth', 'Directory'),
    ('Zendesk', 'Ticketing', 'Data actions', 'API key', 'Architect'),
    ('Power BI Export', 'Analytics', 'Client application', 'OAuth', 'Supervisors'),
]

# Permission domains (Roles / Permissions page) — must match the frontend's
# PERMISSION_DOMAINS exactly (frontend/src/features/people-permissions/
# types.ts), which mirrors the UI prototype's PERMS object one-for-one:
# {domain: [entity:action, ...]}. A role's perms are 'domain:entity:action'
# strings, e.g. 'directory:user:view'.
PERMS = {
    'directory': ['user:add', 'user:edit', 'user:view', 'user:delete', 'group:add', 'group:edit', 'location:add', 'location:edit'],
    'authorization': ['role:add', 'role:edit', 'role:view', 'role:delete', 'division:add', 'division:edit', 'division:delete', 'grant:add'],
    'routing': ['queue:add', 'queue:edit', 'queue:view', 'skill:add', 'skill:edit', 'wrapupCode:add', 'email:manage', 'message:manage'],
    'conversation': ['call:accept', 'call:record', 'call:monitor', 'call:coach', 'call:barge', 'callback:add', 'email:accept', 'message:accept'],
    'analytics': ['view:view', 'dashboard:add', 'dashboard:edit', 'alert:add', 'alert:edit', 'export:add'],
    'quality': ['evaluation:add', 'evaluation:edit', 'calibration:add', 'recording:view', 'recordingPolicy:edit'],
    'telephony': ['plugin:all', 'trunk:edit', 'site:edit', 'edge:edit', 'phone:add', 'phone:assign', 'did:edit', 'extension:edit'],
    'architect': ['flow:add', 'flow:edit', 'flow:publish', 'flow:delete', 'prompt:add', 'datatable:edit'],
    'outbound': ['campaign:add', 'campaign:edit', 'contactList:add', 'dnc:edit', 'ruleSet:edit'],
    'wem': ['schedule:add', 'schedule:edit', 'forecast:add', 'adherence:view', 'gamification:edit'],
}
_ALL_PERMS = [f'{domain}:{action}' for domain, actions in PERMS.items() for action in actions]

# Roles (name, description, base, perms) — the same 7 the prototype seeds.
# 'Employee' is the one every seeded user gets in addition to their own
# role(s) — same "base role nobody can remove" behaviour as the prototype.
ROLES = [
    ('Master Admin', 'Full organisation control', True, _ALL_PERMS),
    ('Admin', 'Administer most settings', True,
     [p for p in _ALL_PERMS if p != 'authorization:division:delete']),
    ('Employee', 'Base role for every user', True,
     ['directory:user:view', 'conversation:call:accept', 'conversation:callback:add']),
    ('Agent', 'Handle ACD interactions', True,
     ['directory:user:view', 'conversation:call:accept', 'conversation:email:accept', 'conversation:message:accept',
      'conversation:callback:add', 'routing:queue:view', 'analytics:view:view']),
    ('Supervisor', 'Queue & agent management', True,
     ['directory:user:view', 'routing:queue:view', 'routing:queue:edit', 'conversation:call:monitor',
      'conversation:call:coach', 'conversation:call:barge', 'analytics:view:view', 'analytics:dashboard:add',
      'analytics:alert:add', 'wem:adherence:view']),
    ('Telephony Admin', 'Edges, trunks, phones, numbers', True,
     ['telephony:plugin:all', 'telephony:trunk:edit', 'telephony:site:edit', 'telephony:edge:edit',
      'telephony:phone:add', 'telephony:phone:assign', 'telephony:did:edit', 'telephony:extension:edit']),
    ('Quality Evaluator', 'Evaluations & calibration', True,
     ['quality:evaluation:add', 'quality:evaluation:edit', 'quality:calibration:add', 'quality:recording:view',
      'analytics:view:view']),
]

SKILLS = ['Billing', 'Technical', 'Retention', 'Sales', 'Collections']
LANGS = ['English', 'Spanish', 'Hindi', 'French']

# backend/app.py's GET /api/subscription/overview reads these two tables
# directly (with no tenant filter — invoices/usage_log are global, not
# per-tenant, matching how the rest of that route's schema already works)
# to fill the Subscription page's Usage tab, Invoices tab, and AI Tokens
# gauge. Without a seed, both tables start empty and those three sections
# render as real zeros — the route isn't broken, it's just wired up to
# nothing to display. Two invoices (one paid, one still open this month)
# and one usage_log row per metric ('voice_min'|'sms'|'storage_gb'|
# 'ai_tokens') give it something real to show.
INVOICES = [
    ('Jul 2026', 'INV-2026-07', 44210.0, 'Paid'),
    ('Aug 2026', 'INV-2026-08', 46870.0, 'Open'),
]

USAGE_LOG = [
    ('voice_min', 12480.0),
    ('sms', 3260.0),
    ('storage_gb', 148.0),
    ('ai_tokens', 64000.0),
]

# division matches the frontend's fixed 5-division set (d_home/d_ret/d_dig/d_col/d_man)
# email follows the same first-initial+surname@mcmgroup.com pattern the
# frontend's own demo seed (mkU calls in scripts.ts) already uses.
# Matches frontend/src/mcm/apps-redesign.ts's INSTALLED_APPS_FALLBACK exactly
# (id, name, category code, category label, icon key, description,
# permissions) so the UI looks identical whether it's reading this seed data
# or its own local fallback. installed=True apps start 'active'/'Connected';
# the 4 available apps start installed=False/'inactive'/'Not connected'.
INSTALLED_APPS = [
    ('salesforce-cx-cloud', 'Salesforce CX Cloud', 'crm', 'CRM Integration', 'cloud', 'Embedded CTI and screen pop',
     ['Read customer records', 'Write interaction history', 'Screen pop on inbound calls'], '2 minutes ago'),
    ('servicenow-unified', 'ServiceNow Unified', 'itsm', 'ITSM Integration', 'settings', 'Front and back office',
     ['Read/write incidents', 'Read CMDB assets', 'Sync front & back office cases'], '5 minutes ago'),
    ('customised-analytics', 'Customised Analytics', 'analytics', 'Reporting & BI', 'barChart', 'Prebuilt and custom dashboards',
     ['Read historical data', 'Export reports', 'Manage custom dashboards'], '12 minutes ago'),
    ('bot-manager', 'Bot Manager', 'automation', 'Automation & Bots', 'cpu', 'Native and third-party bots',
     ['Manage bot flows', 'Read conversation transcripts', 'Deploy bot updates'], '1 minute ago'),
    ('workforce-mobile', 'Workforce Mobile', 'workforce', 'Workforce Management', 'smartphone', 'Schedules and time-off',
     ['Read/write schedules', 'Manage time-off requests', 'Send push notifications'], '8 minutes ago'),
    ('secure-payments', 'Secure Payments', 'payments', 'Payments & Compliance', 'lock', 'PCI card capture',
     ['PCI-scoped card capture', 'Tokenize payment data', 'Write audit trail logs'], '20 minutes ago'),
    ('agent-copilot', 'Agent Copilot', 'ai', 'AI & Agent Assist', 'headset', 'Real-time assistance',
     ['Read live transcript', 'Suggest agent responses', 'Access knowledge base'], 'Just now'),
    ('knowledge-workbench', 'Knowledge Workbench', 'knowledge', 'Knowledge Management', 'bookOpen', 'Article authoring',
     ['Read/write articles', 'Manage publishing workflow', 'Access search index'], '30 minutes ago'),
]

# Matches frontend/src/mcm/apps-redesign.ts's AVAILABLE_APPS_FALLBACK exactly —
# the 4 AppFoundry catalogue integrations also listed on Admin > Integrations
# > Catalogue. category_label doubles as the badge text ('CRM', 'UC', etc).
AVAILABLE_APPS = [
    ('salesforce-cti', 'Salesforce CTI', 'crm', 'CRM', 'cloud', 'Click-to-dial and screen pop from Salesforce',
     ['Read/write Salesforce contacts', 'Screen pop on inbound calls', 'Log call activity to Salesforce']),
    ('microsoft-teams', 'Microsoft Teams', 'uc', 'UC', 'users', 'Presence sync and click-to-chat with Teams',
     ['Read Teams presence status', 'Send click-to-chat messages', 'Sync calendar availability']),
    ('zendesk', 'Zendesk', 'ticketing', 'Ticketing', 'messageSquare', 'Two-way ticket sync for every interaction',
     ['Create and update Zendesk tickets', 'Read ticket status', 'Attach interaction transcripts']),
    ('power-bi-export', 'Power BI Export', 'analytics', 'Analytics', 'barChart', 'Scheduled exports of contact centre data to Power BI',
     ['Read historical reporting data', 'Export scheduled datasets', 'Manage export schedule']),
]

# Matches frontend/src/mcm/canned-redesign.ts's CANNED_FALLBACK exactly (id,
# name, category code, body, created_at, updated_at) so the UI looks
# identical whether it's reading this seed data or its own local fallback.
# substitution_fields is derived here the same way the frontend derives it
# (the {{Token}} markers inside body) rather than hand-duplicated separately
# from the text that defines them.
CANNED_RESPONSES = [
    ('cr-greeting-email', 'Greeting — email', 'greetings',
     'Dear {{Contact.FirstName}}, thank you for contacting MCM Support.',
     '2026-01-04T09:00:00Z', '2026-01-04T09:00:00Z'),
    ('cr-greeting-call', 'Greeting — call opener', 'greetings',
     'Hi {{Contact.FirstName}}, thanks for calling MCM, this is {{Agent.FirstName}} — how can I help today?',
     '2026-01-05T09:00:00Z', '2026-01-05T09:00:00Z'),
    ('cr-payment-received', 'Payment received', 'billing',
     'We confirm receipt of your payment. Your balance is now {{Contact.Balance}}.',
     '2026-01-06T10:00:00Z', '2026-02-11T14:20:00Z'),
    ('cr-billing-dispute', 'Billing dispute acknowledged', 'billing',
     'We have logged your dispute for invoice {{Invoice.Number}} and will respond within 3 business days.',
     '2026-01-08T11:00:00Z', '2026-01-08T11:00:00Z'),
    ('cr-password-reset', 'Password reset instructions', 'technical',
     'Hi {{Contact.FirstName}}, please reset your password at the link we just emailed to {{Contact.Email}}.',
     '2026-01-10T09:30:00Z', '2026-01-10T09:30:00Z'),
    ('cr-outage-notice', 'Technical outage notice', 'technical',
     'We are aware of an issue affecting {{Service.Name}} and are working on a fix. Updates at status.mcmgroup.com.',
     '2026-01-12T08:00:00Z', '2026-03-02T16:45:00Z'),
    ('cr-escalate-supervisor', 'Escalated to supervisor', 'escalation',
     'Your case has been escalated to {{Supervisor.Name}} and will be reviewed within 24 hours.',
     '2026-01-14T13:00:00Z', '2026-01-14T13:00:00Z'),
    ('cr-call-closing', 'Thank you — call closing', 'closing',
     'Thank you for calling MCM, {{Contact.FirstName}}. Is there anything else I can help you with today?',
     '2026-01-16T15:00:00Z', '2026-01-16T15:00:00Z'),
    ('cr-general-followup', 'General follow-up', 'general',
     'Just checking in on your recent request — let us know if you need anything further, {{Contact.FirstName}}.',
     '2026-01-18T12:00:00Z', '2026-01-18T12:00:00Z'),
]

# Matches frontend/src/mcm/certs-redesign.ts's CERTIFICATES_FALLBACK exactly
# — the same 7 certificates the page's static prototype HTML used to hardcode
# (id, name, purpose, issued_to, issuer, division, valid_from, expires_at).
# '' division = not division-scoped (root/global CAs).
CERTIFICATES = [
    ('cert-byoc-sbc-2026', 'byoc-sbc-2026.pem', 'BYOC trunk', 'sbc.mcmgroup.example', 'DigiCert TLS RSA',
     'd_home', '2026-02-14', '2027-02-14'),
    ('cert-edge-hq-lon-01', 'edge-hq-lon-01.pem', 'Edge SIP TLS', 'edge-hq-lon-01.mcm.local', 'MCM Internal CA',
     'd_home', '2026-01-02', '2027-01-02'),
    ('cert-edge-hq-lon-02', 'edge-hq-lon-02.pem', 'Edge SIP TLS', 'edge-hq-lon-02.mcm.local', 'MCM Internal CA',
     'd_home', '2026-01-02', '2027-01-02'),
    ('cert-entra-signing-2026', 'entra-signing-2026.cer', 'SAML signing', 'sts.windows.net', 'Microsoft',
     '', '2026-02-14', '2027-02-14'),
    ('cert-partner-mtls-northstar', 'partner-mtls-northstar.pem', 'Mutual TLS', 'api.northstarbpo.example', 'Sectigo',
     'd_man', '2025-08-30', '2026-08-30'),
    ('cert-legacy-pbx-2024', 'legacy-pbx-2024.pem', 'PBX trunk', 'pbx.mcm.local', 'MCM Internal CA',
     'd_ret', '2024-11-11', '2025-11-11'),
    ('cert-mcm-internal-root', 'mcm-internal-root.pem', 'Root CA', 'MCM Internal CA', 'Self-signed',
     '', '2024-01-01', '2034-01-01'),
]

# No CONTACT_LISTS / DNC_LISTS constants: the Outbound demo data (2 contact
# lists with 13 contacts, 1 DNC list with 2 numbers) was removed along with
# the matching CONTACT_LISTS_FALLBACK / DNC_LISTS_FALLBACK arrays in the
# frontend. Those tables start empty and stay empty until someone creates a
# real record.

# Matches frontend/src/mcm/authorg-redesign.ts's authorgData mock array
# exactly (org_name, org_id, domain, relationship, scope_roles, divisions,
# status, expires_at, notes, created_at) — without this seed, a fresh tenant
# has zero rows in auth_org_trusts, GET /api/v2/authorization/trusts returns
# [], and loadTrustsFromApi()'s `if (!list.length) return;` guard leaves the
# frontend showing its local mock data with fake string ids ('org_ie', ...)
# that don't exist in the database — every edit/revoke/delete against them
# then 404s silently (the fetch failure is swallowed) instead of persisting.
# auth_org_trusts.id is SERIAL, not a slug, so this is guarded by a
# tenant-scoped existence check rather than ON CONFLICT.
AUTH_ORG_TRUSTS = [
    ('MCM Retail Ireland', 'a19c4b82-9f33-44f1-bc82-019e28344fa1', 'retail.ie.mcmgroup.com · EU (Dublin)',
     'Trustee', ['Contact Centre Admin'], ['UK Retail', 'IE Retail'], 'Active', '2026-12-31',
     'Regional operations management for Irish entity. Provisioned under standard Master Services Agreement.', '2026-01-15'),
    ('Northstar BPO', '77bd18f0-1a22-49a1-8e01-cc82910499a1', 'partner.northstarbpo.ph · Asia (Manila)',
     'Trustee', ['Supervisor', 'Agent'], ['Partner — Manila'], 'Active', '2026-09-30',
     'Outsourced tier-1 customer support partner handling voice & digital queues.', '2026-03-10'),
    ('MCM Group PLC', '8f14e45f-ceea-4d3b-9c7f-2b1a0d7e33aa', 'mcmcloudcx.com · EU (London) · Parent Entity',
     'Owner', ['Root / Full Platform Access'], ['All'], 'Owner', None,
     'Primary billing and root governance entity holding platform ownership.', '2024-06-01'),
    ('Cloudline Partners', '32ee991a-4421-40c8-8812-7819920100c8', 'cloudline.co.uk · EU (London)',
     'Trustee', ['Read-only Admin'], ['UK Digital'], 'Expiring soon', '2026-08-11',
     'External security auditor reviewing chat routing and data privacy compliance.', '2026-02-20'),
    ('Vertex Consulting', 'be408819-aa21-4712-9c12-381902847712', 'vertex-cx.com · US (East)',
     'Trustee', ['Implementation'], ['All'], 'Revoked', '2026-07-18',
     'Architect flow migration partner. Project completed and access revoked.', '2025-11-05'),
]

USERS = [
    ('Faisal Khan', 'fkhan@mcmgroup.com', 'CX 3', 'Active', 'd_home'),
    ('Adnan Shaikh', 'ashaikh@mcmgroup.com', 'CX 3', 'Active', 'd_home'),
    ('Sofia Petrova', 'spetrova@mcmgroup.com', 'CX 2', 'Active', 'd_ret'),
    ('James Okafor', 'jokafor@mcmgroup.com', 'CX 2', 'Active', 'd_ret'),
    ('Priya Nair', 'pnair@mcmgroup.com', 'CX 2', 'Active', 'd_ret'),
    ('Marco Rossi', 'mrossi@mcmgroup.com', 'CX 1', 'Active', 'd_dig'),
    ('Aisha Rahman', 'arahman@mcmgroup.com', 'CX 1', 'Active', 'd_dig'),
    ('Carlos Mendez', 'cmendez@mcmgroup.com', 'CX 2', 'Active', 'd_col'),
    ('Grace Adeyemi', 'gadeyemi@mcmgroup.com', 'CX 3', 'Active', 'd_col'),
    ('Rajan Patel', 'rpatel@mcmgroup.com', 'CX 2', 'Inactive', 'd_col'),
    ('Elena Volkov', 'evolkov@mcmgroup.com', 'CX 4', 'Active', 'd_man'),
    ('Tariq Malik', 'tmalik@mcmgroup.com', 'CX 4', 'Active', 'd_man'),
    ('Ngozi Eze', 'neze@mcmgroup.com', 'Communicate', 'Active', 'd_home'),
    ('Haruto Sato', 'hsato@mcmgroup.com', 'Communicate', 'Active', 'd_ret'),
]

# A handful of representative users get a role beyond the 'Employee'
# baseline plus a skill/language or two — everyone else just gets
# 'Employee' with no skills/langs. Deliberately light: this is demo
# flavour so the People page's Roles/Skills columns aren't all identical,
# not a full org chart. The last tuple element is lang_proficiency
# (1-5 per language, an addition beyond the UI prototype — see
# Person.langProficiency in the frontend) so the demo data actually shows
# the ratings varying, not just uniform membership.
USER_EXTRAS = {
    'fkhan@mcmgroup.com': (['Admin', 'Supervisor'], {'Billing': 4}, ['English'], {'English': 5}),
    'ashaikh@mcmgroup.com': (['Supervisor'], {'Technical': 3}, ['English'], {'English': 4}),
    'spetrova@mcmgroup.com': (['Agent'], {'Billing': 3}, ['English', 'Spanish'], {'English': 3, 'Spanish': 5}),
    'jokafor@mcmgroup.com': (['Agent'], {'Sales': 4}, ['English'], {'English': 4}),
    'gadeyemi@mcmgroup.com': (['Quality Evaluator'], {}, ['English'], {'English': 3}),
}


def run():
    with open(SCHEMA_PATH, 'r', encoding='utf-8') as f:
        schema_sql = f.read()

    conn = get_db()
    cur = conn.cursor()
    cur.execute(schema_sql)
    conn.commit()

    cur.execute('SELECT id FROM tenants WHERE name = %s', (os.environ.get('OG_DEFAULT_TENANT', 'MCM Group'),))
    tenant = cur.fetchone()
    if tenant is None:
        cur.execute('INSERT INTO tenants (name) VALUES (%s) RETURNING id', (os.environ.get('OG_DEFAULT_TENANT', 'MCM Group'),))
        tenant = cur.fetchone()
    tenant_id = tenant['id']

    cur.execute('SELECT COUNT(*) AS n FROM roles WHERE tenant_id = %s', (tenant_id,))
    if cur.fetchone()['n'] == 0:
        for name, description, base, perms in ROLES:
            cur.execute(
                'INSERT INTO roles (tenant_id, name, description, base, perms) VALUES (%s,%s,%s,%s,%s)',
                (tenant_id, name, description, base, perms),
            )

    cur.execute('SELECT COUNT(*) AS n FROM simple_entities WHERE tenant_id = %s AND kind = %s', (tenant_id, 'skill'))
    if cur.fetchone()['n'] == 0:
        for name in SKILLS:
            cur.execute(
                'INSERT INTO simple_entities (tenant_id, kind, name) VALUES (%s,%s,%s)',
                (tenant_id, 'skill', name),
            )

    cur.execute('SELECT COUNT(*) AS n FROM simple_entities WHERE tenant_id = %s AND kind = %s', (tenant_id, 'lang'))
    if cur.fetchone()['n'] == 0:
        for name in LANGS:
            cur.execute(
                'INSERT INTO simple_entities (tenant_id, kind, name) VALUES (%s,%s,%s)',
                (tenant_id, 'lang', name),
            )

    for div_code, name, description, is_home in DIVISIONS:
        cur.execute(
            'INSERT INTO divisions (code, tenant_id, name, description, is_home) VALUES (%s,%s,%s,%s,%s) ON CONFLICT (code) DO NOTHING',
            (div_code, tenant_id, name, description, is_home),
        )

    for code, label, purchased, unit_price in LICENSES:
        cur.execute(
            'INSERT INTO licenses (code, label, purchased, unit_price) VALUES (%s,%s,%s,%s) ON CONFLICT (code) DO NOTHING',
            (code, label, purchased, unit_price),
        )

    for name, category, itype, credentials, used_by in INTEGRATION_CATALOGUE:
        cur.execute(
            """
            INSERT INTO integration_catalogue (tenant_id, name, category, type, credentials, used_by)
            VALUES (%s,%s,%s,%s,%s,%s)
            ON CONFLICT (tenant_id, name) DO NOTHING
            """,
            (tenant_id, name, category, itype, credentials, used_by),
        )

    for app_id, name, category, category_label, icon, description, permissions, last_sync_label in INSTALLED_APPS:
        cur.execute(
            """
            INSERT INTO apps (id, tenant_id, name, category, category_label, icon, description, permissions,
                               installed, status, status_label, integration_status, last_sync_label, installed_at)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s, true, 'active', 'Active', 'Connected', %s, now())
            ON CONFLICT (id) DO NOTHING
            """,
            (app_id, tenant_id, name, category, category_label, icon, description, permissions, last_sync_label),
        )

    for app_id, name, category, category_label, icon, description, permissions in AVAILABLE_APPS:
        cur.execute(
            """
            INSERT INTO apps (id, tenant_id, name, category, category_label, icon, description, permissions)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s)
            ON CONFLICT (id) DO NOTHING
            """,
            (app_id, tenant_id, name, category, category_label, icon, description, permissions),
        )

    for cr_id, name, category, body, created_at, updated_at in CANNED_RESPONSES:
        cur.execute(
            """
            INSERT INTO canned_responses (id, tenant_id, name, category, category_label, body,
                                           substitution_fields, created_at, updated_at)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)
            ON CONFLICT (id) DO NOTHING
            """,
            (cr_id, tenant_id, name, category, CANNED_CATEGORY_LABELS.get(category, 'General'), body,
             _extract_substitution_fields(body), created_at, updated_at),
        )

    for cert_id, name, purpose, issued_to, issuer, division, valid_from, expires_at in CERTIFICATES:
        cur.execute(
            """
            INSERT INTO certificates (id, tenant_id, name, purpose, issued_to, issuer, division,
                                       valid_from, expires_at)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)
            ON CONFLICT (id) DO NOTHING
            """,
            (cert_id, tenant_id, name, purpose, issued_to, issuer, division, valid_from, expires_at),
        )

    # No contact lists are seeded here, for the same reason as the DNC lists
    # below: the two demo lists and their 13 contacts were re-inserted on
    # every boot, so any cleanup was undone by the next restart or deploy.
    # contact_lists/contacts now come only from a real user action through
    # contactlists.py's own API (or a CSV import).

    # Integrations Phase 2 cleanup: no Data Actions are seeded here. They,
    # like installed_integrations/integration_credentials/bot_connectors/
    # data_action_runs, only ever come from a real, explicit user action
    # through dataact.py's own API (create_action() already derives
    # data_action_contracts from the contract string via
    # _sync_contract_fields() at creation time, so there is nothing left for
    # a boot-time backfill here to do).

    # No DNC lists are seeded here. The demo 'UK-Internal-DNC' list and its
    # two numbers used to be re-inserted on every boot (ON CONFLICT DO
    # NOTHING, with no empty-table guard), so deleting them from the database
    # only lasted until the next restart or deploy. dnc_lists/dnc_numbers now
    # come only from a real user action through dnclists.py's own API.

    cur.execute('SELECT COUNT(*) AS n FROM auth_org_trusts WHERE tenant_id = %s', (tenant_id,))
    if cur.fetchone()['n'] == 0:
        for org_name, org_id, domain, relationship, scope_roles, divisions, status, expires_at, notes, created_at in AUTH_ORG_TRUSTS:
            cur.execute(
                """
                INSERT INTO auth_org_trusts (tenant_id, org_name, org_id, domain, relationship, scope_roles,
                                              divisions, status, expires_at, notes, created_at)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                """,
                (tenant_id, org_name, org_id, domain, relationship, scope_roles, divisions, status,
                 expires_at, notes, created_at),
            )

    cur.execute('SELECT COUNT(*) AS n FROM invoices')
    if cur.fetchone()['n'] == 0:
        for period_label, reference, total, status in INVOICES:
            cur.execute(
                'INSERT INTO invoices (period_label, reference, total, status) VALUES (%s,%s,%s,%s)',
                (period_label, reference, total, status),
            )

    cur.execute('SELECT COUNT(*) AS n FROM usage_log')
    if cur.fetchone()['n'] == 0:
        for metric, amount in USAGE_LOG:
            cur.execute(
                'INSERT INTO usage_log (metric, amount, recorded_at) VALUES (%s,%s,%s)',
                (metric, amount, datetime.now()),
            )

    cur.execute('SELECT COUNT(*) AS n FROM users')
    if cur.fetchone()['n'] == 0:
        for name, email, license_code, state, division in USERS:
            cur.execute(
                'INSERT INTO users (tenant_id, name, email, license_code, state, division, password_hash) VALUES (%s,%s,%s,%s,%s,%s,%s)',
                (tenant_id, name, email, license_code, state, division, DEMO_PASSWORD_HASH),
            )
    else:
        # backfill columns added after these rows were first seeded
        for name, email, license_code, state, division in USERS:
            cur.execute(
                'UPDATE users SET division = %s WHERE name = %s AND division IS NULL',
                (division, name),
            )
            cur.execute(
                'UPDATE users SET email = %s WHERE name = %s AND email IS NULL',
                (email, name),
            )
            cur.execute(
                'UPDATE users SET password_hash = %s WHERE name = %s AND password_hash IS NULL',
                (DEMO_PASSWORD_HASH, name),
            )

    # Every seeded user gets the 'Employee' baseline role (can't be
    # unassigned in the UI — see PersonDrawer); a few also get a second
    # role plus a skill/language from USER_EXTRAS above. Only touches rows
    # that still have no roles assigned, so this never clobbers real edits.
    cur.execute('SELECT id, name FROM roles WHERE tenant_id = %s', (tenant_id,))
    role_id_by_name = {r['name']: r['id'] for r in cur.fetchall()}
    employee_role_id = role_id_by_name.get('Employee')
    if employee_role_id is not None:
        for _, email, _, _, _ in USERS:
            extra_roles, skills, langs, lang_proficiency = USER_EXTRAS.get(email, ([], {}, [], {}))
            role_ids = [employee_role_id] + [role_id_by_name[r] for r in extra_roles if r in role_id_by_name]
            cur.execute(
                "UPDATE users SET roles = %s, skills = %s, langs = %s, lang_proficiency = %s "
                "WHERE email = %s AND array_length(roles, 1) IS NULL",
                (role_ids, skills, langs, lang_proficiency, email),
            )

    # lang_proficiency backfill: any user who already speaks a language
    # (present in langs, from before this column existed, or added directly
    # some other way) but has no rating for it yet gets a default of 3 —
    # otherwise the People page would show an assigned language as "Not
    # assigned" until someone happens to open and re-save that person.
    # Idempotent (only touches rows genuinely missing an entry) so it's
    # safe to run on every startup, same as the rest of this function.
    cur.execute(
        """
        UPDATE users SET lang_proficiency = (
            SELECT jsonb_object_agg(lang, COALESCE(lang_proficiency -> lang, to_jsonb(3)))
            FROM unnest(langs) AS lang
        )
        WHERE array_length(langs, 1) > 0
          AND EXISTS (SELECT 1 FROM unnest(langs) AS l WHERE NOT lang_proficiency ? l)
        """
    )

    # audit_log tenant_id backfill: the table predates multi-tenancy, so any
    # row left over from before this column existed has no tenant recorded.
    # Attribute those to the current tenant (they can only have come from
    # actions taken against this deployment) rather than leave them globally
    # visible to every tenant sharing this database. Idempotent (only touches
    # rows still missing a tenant) so it's safe to run on every startup.
    cur.execute('UPDATE audit_log SET tenant_id = %s WHERE tenant_id IS NULL', (tenant_id,))

    # Same backfill for purchases — see its tenant_id comment in schema.sql.
    cur.execute('UPDATE purchases SET tenant_id = %s WHERE tenant_id IS NULL', (tenant_id,))

    conn.commit()
    conn.close()
