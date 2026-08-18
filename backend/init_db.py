"""
One-time schema + demo-data setup, run at import time (see app.py). The
Render Postgres instance starts empty — nothing here has ever run schema.sql
against it — so every query 500s until tables exist. schema.sql is all
CREATE TABLE IF NOT EXISTS / idempotent DDL, and the seed step below only
inserts when `users` is empty, so this is safe to run on every boot.
"""

import os
from db import get_db

SCHEMA_PATH = os.path.join(os.path.dirname(__file__), '..', 'database', 'schema.sql')

LICENSES = [
    ('CX 1', 'CX 1 — Voice', 40, 75),
    ('CX 2', 'CX 2 — Digital', 60, 115),
    ('CX 3', 'CX 3 — WEM', 25, 155),
    ('CX 4', 'CX 4 — AI', 10, 240),
    ('Communicate', 'Communicate', 50, 18),
]

# division matches the frontend's fixed 5-division set (d_home/d_ret/d_dig/d_col/d_man)
USERS = [
    ('Faisal Khan', 'CX 3', 'Active', 'd_home'),
    ('Adnan Shaikh', 'CX 3', 'Active', 'd_home'),
    ('Sofia Petrova', 'CX 2', 'Active', 'd_ret'),
    ('James Okafor', 'CX 2', 'Active', 'd_ret'),
    ('Priya Nair', 'CX 2', 'Active', 'd_ret'),
    ('Marco Rossi', 'CX 1', 'Active', 'd_dig'),
    ('Aisha Rahman', 'CX 1', 'Active', 'd_dig'),
    ('Carlos Mendez', 'CX 2', 'Active', 'd_col'),
    ('Grace Adeyemi', 'CX 3', 'Active', 'd_col'),
    ('Rajan Patel', 'CX 2', 'Inactive', 'd_col'),
    ('Elena Volkov', 'CX 4', 'Active', 'd_man'),
    ('Tariq Malik', 'CX 4', 'Active', 'd_man'),
    ('Ngozi Eze', 'Communicate', 'Active', 'd_home'),
    ('Haruto Sato', 'Communicate', 'Active', 'd_ret'),
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

    for code, label, purchased, unit_price in LICENSES:
        cur.execute(
            'INSERT INTO licenses (code, label, purchased, unit_price) VALUES (%s,%s,%s,%s) ON CONFLICT (code) DO NOTHING',
            (code, label, purchased, unit_price),
        )

    cur.execute('SELECT COUNT(*) AS n FROM users')
    if cur.fetchone()['n'] == 0:
        for name, license_code, state, division in USERS:
            cur.execute(
                'INSERT INTO users (tenant_id, name, license_code, state, division) VALUES (%s,%s,%s,%s,%s)',
                (tenant_id, name, license_code, state, division),
            )
    else:
        # backfill division on users seeded before this column existed
        for name, license_code, state, division in USERS:
            cur.execute(
                'UPDATE users SET division = %s WHERE name = %s AND division IS NULL',
                (division, name),
            )

    conn.commit()
    conn.close()
