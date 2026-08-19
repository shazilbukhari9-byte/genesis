"""
One-time schema + demo-data setup, run at import time (see app.py). The
Render Postgres instance starts empty — nothing here has ever run schema.sql
against it — so every query 500s until tables exist. schema.sql is all
CREATE TABLE IF NOT EXISTS / idempotent DDL, and the seed step below only
inserts when `users` is empty, so this is safe to run on every boot.
"""

import os
import re
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

    conn.commit()
    conn.close()
