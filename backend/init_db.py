"""
One-time schema + demo-data setup, run at import time (see app.py). The
Render Postgres instance starts empty — nothing here has ever run schema.sql
against it — so every query 500s until tables exist. schema.sql is all
CREATE TABLE IF NOT EXISTS / idempotent DDL, and the seed step below only
inserts when `users` is empty, so this is safe to run on every boot.
"""

import os
<<<<<<< HEAD
=======
from werkzeug.security import generate_password_hash
>>>>>>> 2ca736438226df3e9d34ce710779ce4eb6064e7e
from db import get_db

SCHEMA_PATH = os.path.join(os.path.dirname(__file__), '..', 'database', 'schema.sql')

<<<<<<< HEAD
=======
# All seeded demo accounts share this password so they stay loggable now
# that /api/auth/login actually checks one — fine for a demo tenant, not a
# pattern to keep once real users outnumber seed data.
DEMO_PASSWORD_HASH = generate_password_hash('demo1234')

>>>>>>> 2ca736438226df3e9d34ce710779ce4eb6064e7e
LICENSES = [
    ('CX 1', 'CX 1 — Voice', 40, 75),
    ('CX 2', 'CX 2 — Digital', 60, 115),
    ('CX 3', 'CX 3 — WEM', 25, 155),
    ('CX 4', 'CX 4 — AI', 10, 240),
    ('Communicate', 'Communicate', 50, 18),
]

<<<<<<< HEAD
USERS = [
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
=======
# division matches the frontend's fixed 5-division set (d_home/d_ret/d_dig/d_col/d_man)
# email follows the same first-initial+surname@mcmgroup.com pattern the
# frontend's own demo seed (mkU calls in scripts.ts) already uses.
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
>>>>>>> 2ca736438226df3e9d34ce710779ce4eb6064e7e
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
<<<<<<< HEAD
        for name, license_code, state in USERS:
            cur.execute(
                'INSERT INTO users (tenant_id, name, license_code, state) VALUES (%s,%s,%s,%s)',
                (tenant_id, name, license_code, state),
=======
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
>>>>>>> 2ca736438226df3e9d34ce710779ce4eb6064e7e
            )

    conn.commit()
    conn.close()
