import json
import sqlite3
from datetime import datetime, timedelta

conn = sqlite3.connect('subscription.db')
conn.executescript(open('schema.sql').read())

# safe to re-run: clear existing rows before reseeding
conn.executescript("""
DELETE FROM users;
DELETE FROM usage_log;
DELETE FROM invoices;
DELETE FROM audit_log;
DELETE FROM licenses;
DELETE FROM authorized_organizations;
DELETE FROM authorized_org_audit_logs;
""")

licenses = [
    ('CX 1', 'CX 1 — Voice', 40, 75),
    ('CX 2', 'CX 2 — Digital', 60, 115),
    ('CX 3', 'CX 3 — WEM', 25, 155),
    ('CX 4', 'CX 4 — AI', 10, 240),
    ('Communicate', 'Communicate', 50, 18),
]
conn.executemany(
    'INSERT INTO licenses (code, label, purchased, unit_price) VALUES (?,?,?,?)',
    licenses,
)

users = [
    ('Faisal Khan', 'CX 3', 'Active'),
    ('Adnan Shaikh', 'CX 3', 'Active'),
    ('Sofia Petrova', 'CX 2', 'Active'),
    ('James Okafor', 'CX 2', 'Active'),
    ('Priya Nair', 'CX 2', 'Active'),
    ('Marco Rossi', 'CX 1', 'Active'),
    ('Aisha Rahman', 'CX 1', 'Active'),
    ('Carlos Mendez', 'CX 2', 'Active'),
    ('Grace Adeyemi', 'CX 3', 'Active'),
    ('Rajan Patel', 'CX 2', 'Inactive'),
    ('Elena Volkov', 'CX 4', 'Active'),
    ('Tariq Malik', 'CX 4', 'Active'),
    ('Ngozi Eze', 'Communicate', 'Active'),
    ('Haruto Sato', 'Communicate', 'Active'),
    ('Lucia Fernandez', 'Communicate', 'Active'),
    ('Ben Whitfield', 'CX 1', 'Active'),
    ('Yuki Tanaka', 'CX 3', 'Inactive'),
    ('Omar Farouk', 'CX 2', 'Active'),
]
conn.executemany(
    'INSERT INTO users (name, license_code, state) VALUES (?,?,?)',
    users,
)

# usage_log rows across the last several days, so overview totals reflect
# a spread of activity rather than one lump entry
now = datetime.now()
usage = []
daily = [
    ('voice_min', 210), ('voice_min', 165), ('voice_min', 240), ('voice_min', 190),
    ('voice_min', 388),
    ('sms', 11), ('sms', 8), ('sms', 15), ('sms', 9), ('sms', 16),
    ('storage_gb', 9.2), ('storage_gb', 7.8), ('storage_gb', 10.1),
    ('storage_gb', 8.4), ('storage_gb', 6.6),
    ('ai_tokens', 0), ('ai_tokens', 0), ('ai_tokens', 0),
]
for i, (metric, amount) in enumerate(daily):
    usage.append((metric, amount, (now - timedelta(days=len(daily) - i)).isoformat()))
conn.executemany(
    'INSERT INTO usage_log (metric, amount, recorded_at) VALUES (?,?,?)',
    usage,
)

def months_ago(base, n):
    year, month = base.year, base.month
    for _ in range(n):
        month -= 1
        if month == 0:
            month = 12
            year -= 1
    return base.replace(year=year, month=month, day=1)

invoices = []
totals = [1221, 1214, 1207, 1198, 1183, 1176]  # current period first .. oldest last
for off in reversed(range(6)):  # oldest first, so DESC-by-id fetch gives newest first
    d = months_ago(now, off)
    label = d.strftime('%B %Y')
    ref = d.strftime('INV-%Y-%m')
    total = totals[off]
    status = 'Open' if off == 0 else 'Paid'
    invoices.append((label, ref, total, status))

conn.executemany(
    'INSERT INTO invoices (period_label, reference, total, status) VALUES (?,?,?,?)',
    invoices,
)

audit = [
    ('System', 'Org provisioned', 'mcmgroup', (now - timedelta(days=200)).isoformat()),
    ('Faisal Khan', 'Bulk import', '12 users created', (now - timedelta(days=180)).isoformat()),
    ('Faisal Khan', 'Plan change requested', 'upgrade CX 2 to annual billing', (now - timedelta(days=40)).isoformat()),
    ('Adnan Shaikh', 'Seats requested', '+5 CX 3 (pool now 25)', (now - timedelta(days=12)).isoformat()),
]
conn.executemany(
    'INSERT INTO audit_log (who, action, detail, created_at) VALUES (?,?,?,?)',
    audit,
)

authorized_organizations = [
    (
        'MCM Retail Ireland', 'a19c4b82-9f33-44f1-bc82-019e28344fa1',
        'retail.ie.mcmgroup.com · EU (Dublin)', 'Trustee',
        json.dumps(['Contact Centre Admin']), json.dumps(['UK Retail', 'IE Retail']),
        '2026-12-31', 'Active',
        'Regional operations management for Irish entity. Provisioned under standard Master Services Agreement.',
        (now - timedelta(days=214)).isoformat(),
    ),
    (
        'Northstar BPO', '77bd18f0-1a22-49a1-8e01-cc82910499a1',
        'partner.northstarbpo.ph · Asia (Manila)', 'Trustee',
        json.dumps(['Supervisor', 'Agent']), json.dumps(['Partner — Manila']),
        '2026-09-30', 'Active',
        'Outsourced tier-1 customer support partner handling voice & digital queues.',
        (now - timedelta(days=160)).isoformat(),
    ),
    (
        'MCM Group PLC', '8f14e45f-ceea-4d3b-9c7f-2b1a0d7e33aa',
        'mcmcloudcx.com · EU (London) · Parent Entity', 'Owner',
        json.dumps(['Root / Full Platform Access']), json.dumps(['All']),
        None, 'Owner',
        'Primary billing and root governance entity holding platform ownership.',
        (now - timedelta(days=807)).isoformat(),
    ),
    (
        'Cloudline Partners', '32ee991a-4421-40c8-8812-7819920100c8',
        'cloudline.co.uk · EU (London)', 'Trustee',
        json.dumps(['Read-only Admin']), json.dumps(['UK Digital']),
        '2026-08-11', 'Expiring soon',
        'External security auditor reviewing chat routing and data privacy compliance.',
        (now - timedelta(days=178)).isoformat(),
    ),
    (
        'Vertex Consulting', 'be408819-aa21-4712-9c12-381902847712',
        'vertex-cx.com · US (East)', 'Trustee',
        json.dumps(['Implementation']), json.dumps(['All']),
        '2026-07-18', 'Revoked',
        'Architect flow migration partner. Project completed and access revoked.',
        (now - timedelta(days=286)).isoformat(),
    ),
]
conn.executemany(
    '''INSERT INTO authorized_organizations
       (org_name, org_id, domain, relationship, scope_roles, divisions, expires_at, status, notes, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)''',
    authorized_organizations,
)

authorized_org_audit = [
    ((now - timedelta(hours=3)).isoformat(), 'retail.ie.mcmgroup.com', 'Faisal Khan',
     'Delegated admin login — assumed role Contact Centre Admin in UK Retail'),
    ((now - timedelta(days=30)).isoformat(), 'vertex-cx.com', 'Master Admin',
     'Trust revoked — access window expired and permissions purged'),
    ((now - timedelta(days=64)).isoformat(), 'cloudline.co.uk', 'Faisal Khan',
     'Scope modified — scoped down to Read-only Admin for UK Digital Division'),
]
conn.executemany(
    '''INSERT INTO authorized_org_audit_logs (timestamp, org_domain, actor_name, action_text)
       VALUES (?,?,?,?)''',
    authorized_org_audit,
)

conn.commit()
conn.close()
print('seeded subscription.db')
