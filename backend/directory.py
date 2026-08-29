"""
Directory module API — /api/directory/*

Backs the directory-redesign.ts frontend module. Each entity is tenant-scoped
via g.tenant_id (set by auth.py's before_request guard). Text arrays (skills,
langs, queues, floors, member_ids) are stored as Postgres TEXT[] / INTEGER[]
columns and serialised to/from JSON lists automatically.

Endpoints mirror what DirectoryService.coll() and the custom SVC methods expect:
  CRUD     /people /groups /locations /profile-fields /external-contacts /workspaces
  Custom   /favourites  /threads/:id/messages  /calls  /emails  /me/presence
"""

from flask import Blueprint, jsonify, request, g
from db import get_db

directory_bp = Blueprint('directory', __name__, url_prefix='/api/directory')


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _log(cur, tenant_id, text):
    cur.execute(
        'INSERT INTO dir_activity (tenant_id, text) VALUES (%s, %s)',
        (tenant_id, text),
    )


def _rows(cur):
    return [dict(r) for r in cur.fetchall()]


def _row(cur):
    r = cur.fetchone()
    return dict(r) if r else None


def _fix_arrays(row):
    """Ensure Postgres arrays come back as JSON-friendly lists."""
    if row is None:
        return None
    for k in ('skills', 'langs', 'queues', 'floors', 'member_ids'):
        if k in row and row[k] is not None:
            row[k] = list(row[k])
    return row


def _validate_title_dept(cur, tenant_id, data, current=None):
    """dir_people.title/dept share the same managed picklist as users.title/
    dept (simple_entities, kind='title'|'dept') -- see backend/app.py's
    _validate_people_fields for the People & Permissions side of this same
    check. entity_create/entity_update otherwise write every column through
    unchecked, which is how this table ended up with arbitrary free-text
    titles/departments in the first place. Blank is still fine (both
    columns are nullable); only a non-blank value has to match the list.

    `current` (the existing row, update-only) lets an edit to some other
    field skip this check when title/dept aren't actually changing -- this
    table already has plenty of free-text values that predate the
    picklist, and re-saving a person's phone number shouldn't suddenly
    fail because their existing title isn't a recognised entry yet."""
    for kind in ('title', 'dept'):
        if kind not in data:
            continue
        if current is not None and data[kind] == current.get(kind):
            continue
        value = (data[kind] or '').strip()
        if not value:
            continue
        cur.execute(
            'SELECT id FROM simple_entities WHERE tenant_id = %s AND kind = %s AND lower(name) = lower(%s)',
            (tenant_id, kind, value),
        )
        if cur.fetchone() is None:
            label = 'job title' if kind == 'title' else 'department'
            return f'"{value}" is not a recognised {label} -- add it first or pick an existing one'
    return None


# ---------------------------------------------------------------------------
# Generic CRUD factory — handles people, groups, locations, profile-fields,
# external-contacts, workspaces. Each declares its table, columns, and
# searchable fields.
# ---------------------------------------------------------------------------

ENTITIES = {
    'people': dict(
        table='dir_people',
        cols=['name', 'title', 'dept', 'division', 'location', 'email',
              'phone', 'ext', 'presence', 'station', 'manager', 'licence',
              'tz', 'started', 'skills', 'langs', 'queues'],
        search=['name', 'email', 'title', 'dept', 'ext'],
        order='name',
        arrays=['skills', 'langs', 'queues'],
    ),
    'groups': dict(
        table='dir_groups',
        cols=['name', 'type', 'ext', 'ring', 'owner', 'member_ids', 'voicemail'],
        search=['name'],
        order='name',
        arrays=['member_ids'],
    ),
    'locations': dict(
        table='dir_locations',
        cols=['name', 'type', 'address', 'country', 'tz', 'hours', 'floors',
              'emergency', 'site', 'status'],
        search=['name'],
        order='name',
        arrays=['floors'],
    ),
    'profile-fields': dict(
        table='dir_profile_fields',
        cols=['label', 'key', 'type', 'section', 'visibility', 'required', 'system',
              'editable_by', 'searchable', 'field_order'],
        search=['label'],
        order='field_order',
        arrays=[],
    ),
    'external-contacts': dict(
        table='dir_external_contacts',
        cols=['name', 'org', 'role', 'email', 'phone', 'relationship',
              'last_contact', 'owner'],
        search=['name', 'org', 'email'],
        order='name',
        arrays=[],
    ),
    'workspaces': dict(
        table='dir_workspaces',
        cols=['name', 'type', 'owner', 'access', 'docs', 'size', 'updated',
              'retention'],
        search=['name'],
        order='name',
        arrays=[],
    ),
}


def _coerce_array(val):
    """Accept a JSON list or a Postgres array literal and return a Python list."""
    if val is None:
        return []
    if isinstance(val, list):
        return val
    return [val]


@directory_bp.route('/<entity>', methods=['GET'])
def entity_list(entity):
    spec = ENTITIES.get(entity)
    if spec is None:
        return jsonify({'ok': False, 'error': 'unknown entity'}), 404

    conn = get_db()
    cur = conn.cursor()
    where = ['tenant_id = %s']
    params = [g.tenant_id]

    q = request.args.get('q')
    if q and spec['search']:
        clauses = ' OR '.join(f'{c} ILIKE %s' for c in spec['search'])
        where.append(f'({clauses})')
        params += [f'%{q}%'] * len(spec['search'])

    # People-specific filters
    if entity == 'people':
        for filt, col in [('dept', 'dept'), ('loc', 'location'), ('pres', 'presence')]:
            v = request.args.get(filt)
            if v:
                where.append(f'{col} = %s')
                params.append(v)

    sql = f"SELECT * FROM {spec['table']} WHERE {' AND '.join(where)} ORDER BY {spec['order']}"
    cur.execute(sql, params)
    rows = _rows(cur)

    # Fix arrays
    for r in rows:
        _fix_arrays(r)

    # People-specific sorting
    if entity == 'people':
        sort = request.args.get('sort')
        if sort == 'presence':
            rank = {'Available': 0, 'On queue': 1, 'Busy': 2, 'Away': 3, 'Offline': 4}
            rows.sort(key=lambda r: (rank.get(r.get('presence', 'Offline'), 9), r.get('name', '')))
        elif sort == 'department':
            rows.sort(key=lambda r: (r.get('dept', ''), r.get('name', '')))
        elif sort == 'location':
            rows.sort(key=lambda r: (r.get('location', ''), r.get('name', '')))

    # Locations: add headcount
    if entity == 'locations':
        for loc in rows:
            cur.execute(
                'SELECT COUNT(*) AS n FROM dir_people WHERE tenant_id = %s AND location = %s',
                (g.tenant_id, loc['name']),
            )
            loc['headcount'] = cur.fetchone()['n']

    conn.close()
    return jsonify(rows)


@directory_bp.route('/<entity>/<int:row_id>', methods=['GET'])
def entity_get(entity, row_id):
    spec = ENTITIES.get(entity)
    if spec is None:
        return jsonify({'ok': False, 'error': 'unknown entity'}), 404

    conn = get_db()
    cur = conn.cursor()
    cur.execute(
        f"SELECT * FROM {spec['table']} WHERE id = %s AND tenant_id = %s",
        (row_id, g.tenant_id),
    )
    row = _row(cur)
    conn.close()
    if row is None:
        return jsonify({'ok': False, 'error': 'not found'}), 404
    return jsonify(_fix_arrays(row))


@directory_bp.route('/<entity>', methods=['POST'])
def entity_create(entity):
    spec = ENTITIES.get(entity)
    if spec is None:
        return jsonify({'ok': False, 'error': 'unknown entity'}), 404

    data = request.get_json(force=True) or {}
    conn = get_db()
    cur = conn.cursor()

    if entity == 'people':
        error = _validate_title_dept(cur, g.tenant_id, data)
        if error:
            conn.close()
            return jsonify({'ok': False, 'error': error}), 400

    cols = ['tenant_id']
    vals = [g.tenant_id]

    for c in spec['cols']:
        if c in data:
            v = data[c]
            if c in spec['arrays']:
                v = _coerce_array(v)
            cols.append(c)
            vals.append(v)

    ph = ', '.join('%s' for _ in cols)
    sql = f"INSERT INTO {spec['table']} ({', '.join(cols)}) VALUES ({ph}) RETURNING *"
    cur.execute(sql, vals)
    row = _row(cur)
    _log(cur, g.tenant_id, f"Created {entity} {data.get('name') or data.get('label') or ''}")
    conn.commit()
    conn.close()
    return jsonify(_fix_arrays(row)), 201


@directory_bp.route('/<entity>/<int:row_id>', methods=['PUT', 'PATCH'])
def entity_update(entity, row_id):
    spec = ENTITIES.get(entity)
    if spec is None:
        return jsonify({'ok': False, 'error': 'unknown entity'}), 404

    data = request.get_json(force=True) or {}
    sets = []
    vals = []
    for c in spec['cols']:
        if c in data:
            v = data[c]
            if c in spec['arrays']:
                v = _coerce_array(v)
            sets.append(f'{c} = %s')
            vals.append(v)

    if not sets:
        return jsonify({'ok': False, 'error': 'no fields supplied'}), 400

    conn = get_db()
    cur = conn.cursor()

    check_cols = 'id, title, dept' if entity == 'people' else 'id'
    cur.execute(
        f"SELECT {check_cols} FROM {spec['table']} WHERE id = %s AND tenant_id = %s",
        (row_id, g.tenant_id),
    )
    current = cur.fetchone()
    if current is None:
        conn.close()
        return jsonify({'ok': False, 'error': 'not found'}), 404

    if entity == 'people':
        error = _validate_title_dept(cur, g.tenant_id, data, current=current)
        if error:
            conn.close()
            return jsonify({'ok': False, 'error': error}), 400

    vals += [row_id, g.tenant_id]
    sql = f"UPDATE {spec['table']} SET {', '.join(sets)} WHERE id = %s AND tenant_id = %s RETURNING *"
    cur.execute(sql, vals)
    row = _row(cur)
    _log(cur, g.tenant_id, f"Updated {entity} {data.get('name') or data.get('label') or row_id}")
    conn.commit()
    conn.close()
    return jsonify(_fix_arrays(row))


@directory_bp.route('/<entity>/<int:row_id>', methods=['DELETE'])
def entity_delete(entity, row_id):
    spec = ENTITIES.get(entity)
    if spec is None:
        return jsonify({'ok': False, 'error': 'unknown entity'}), 404

    conn = get_db()
    cur = conn.cursor()
    cur.execute(
        f"SELECT id FROM {spec['table']} WHERE id = %s AND tenant_id = %s",
        (row_id, g.tenant_id),
    )
    if cur.fetchone() is None:
        conn.close()
        return jsonify({'ok': False, 'error': 'not found'}), 404

    cur.execute(
        f"DELETE FROM {spec['table']} WHERE id = %s AND tenant_id = %s",
        (row_id, g.tenant_id),
    )
    # Also remove from favourites
    cur.execute(
        "DELETE FROM dir_favourites WHERE target_id = %s AND target_type = %s AND tenant_id = %s",
        (row_id, entity, g.tenant_id),
    )
    _log(cur, g.tenant_id, f"Deleted {entity} {row_id}")
    conn.commit()
    conn.close()
    return jsonify({'ok': True})


# ---------------------------------------------------------------------------
# Favourites
# ---------------------------------------------------------------------------

@directory_bp.route('/favourites', methods=['GET'])
def favourites_list():
    conn = get_db()
    cur = conn.cursor()
    cur.execute(
        'SELECT target_id, target_type FROM dir_favourites WHERE tenant_id = %s AND user_id = %s',
        (g.tenant_id, g.user_id),
    )
    favs = _rows(cur)

    people_ids = [f['target_id'] for f in favs if f['target_type'] == 'people']
    group_ids = [f['target_id'] for f in favs if f['target_type'] == 'groups']
    contact_ids = [f['target_id'] for f in favs if f['target_type'] == 'external']

    people, groups, contacts = [], [], []

    if people_ids:
        cur.execute(
            f"SELECT * FROM dir_people WHERE tenant_id = %s AND id = ANY(%s)",
            (g.tenant_id, people_ids),
        )
        people = [_fix_arrays(dict(r)) for r in cur.fetchall()]

    if group_ids:
        cur.execute(
            f"SELECT * FROM dir_groups WHERE tenant_id = %s AND id = ANY(%s)",
            (g.tenant_id, group_ids),
        )
        groups = [_fix_arrays(dict(r)) for r in cur.fetchall()]

    if contact_ids:
        cur.execute(
            f"SELECT * FROM dir_external_contacts WHERE tenant_id = %s AND id = ANY(%s)",
            (g.tenant_id, contact_ids),
        )
        contacts = [dict(r) for r in cur.fetchall()]

    conn.close()
    return jsonify({'people': people, 'groups': groups, 'contacts': contacts})


@directory_bp.route('/favourites/<int:target_id>', methods=['PUT'])
def favourite_set(target_id):
    data = request.get_json(force=True) or {}
    on = data.get('favourite', False)

    conn = get_db()
    cur = conn.cursor()

    # Detect type
    target_type = data.get('type', 'people')

    if on:
        cur.execute(
            """INSERT INTO dir_favourites (tenant_id, user_id, target_id, target_type)
               VALUES (%s, %s, %s, %s) ON CONFLICT DO NOTHING""",
            (g.tenant_id, g.user_id, target_id, target_type),
        )
    else:
        cur.execute(
            "DELETE FROM dir_favourites WHERE tenant_id = %s AND user_id = %s AND target_id = %s",
            (g.tenant_id, g.user_id, target_id),
        )

    conn.commit()

    # Return current fav IDs
    cur.execute(
        'SELECT target_id FROM dir_favourites WHERE tenant_id = %s AND user_id = %s',
        (g.tenant_id, g.user_id),
    )
    ids = [r['target_id'] for r in cur.fetchall()]
    conn.close()
    return jsonify(ids)


# ---------------------------------------------------------------------------
# Threads / chat
# ---------------------------------------------------------------------------

@directory_bp.route('/threads/<int:person_id>/messages', methods=['GET'])
def thread_get(person_id):
    conn = get_db()
    cur = conn.cursor()
    cur.execute(
        """SELECT id, sender AS "from", body AS text,
                  to_char(created_at, 'HH24:MI') AS time
           FROM dir_thread_messages
           WHERE tenant_id = %s AND thread_id = %s
           ORDER BY created_at""",
        (g.tenant_id, person_id),
    )
    rows = _rows(cur)
    conn.close()
    return jsonify(rows)


@directory_bp.route('/threads/<int:person_id>/messages', methods=['POST'])
def thread_send(person_id):
    data = request.get_json(force=True) or {}
    text = data.get('text', '')

    conn = get_db()
    cur = conn.cursor()
    cur.execute(
        """INSERT INTO dir_thread_messages (tenant_id, thread_id, sender, body)
           VALUES (%s, %s, 'me', %s) RETURNING id, sender AS "from", body AS text,
                  to_char(created_at, 'HH24:MI') AS time""",
        (g.tenant_id, person_id, text),
    )
    msg = _row(cur)
    _log(cur, g.tenant_id, f'Message sent to person {person_id}')
    conn.commit()
    conn.close()
    return jsonify(msg), 201


# ---------------------------------------------------------------------------
# Calls
# ---------------------------------------------------------------------------

@directory_bp.route('/calls', methods=['POST'])
def call_start():
    data = request.get_json(force=True) or {}
    conn = get_db()
    cur = conn.cursor()
    cur.execute(
        """INSERT INTO dir_calls (tenant_id, target_id, target_name)
           VALUES (%s, %s, %s) RETURNING id""",
        (g.tenant_id, data.get('targetId'), data.get('targetName')),
    )
    row = _row(cur)
    _log(cur, g.tenant_id, f"Call started with {data.get('targetName', 'unknown')}")
    conn.commit()
    conn.close()
    return jsonify({'callId': row['id']}), 201


@directory_bp.route('/calls/<int:call_id>', methods=['PUT'])
def call_end(call_id):
    data = request.get_json(force=True) or {}
    seconds = data.get('seconds', 0)

    conn = get_db()
    cur = conn.cursor()
    cur.execute(
        """UPDATE dir_calls SET ended_at = now(), duration_s = %s
           WHERE id = %s AND tenant_id = %s RETURNING *""",
        (seconds, call_id, g.tenant_id),
    )
    row = _row(cur)
    if row:
        _log(cur, g.tenant_id, f"Call ended ({seconds}s)")
    conn.commit()
    conn.close()
    return jsonify({'ok': True})


# ---------------------------------------------------------------------------
# Emails (log-only — no actual SMTP)
# ---------------------------------------------------------------------------

@directory_bp.route('/emails', methods=['POST'])
def send_email():
    data = request.get_json(force=True) or {}
    conn = get_db()
    cur = conn.cursor()
    _log(cur, g.tenant_id, f"Email sent to {data.get('to', '?')} — \"{data.get('subject', '')}\"")
    conn.commit()
    conn.close()
    return jsonify({'ok': True}), 201


# ---------------------------------------------------------------------------
# Presence
# ---------------------------------------------------------------------------

@directory_bp.route('/me/presence', methods=['PUT'])
def set_presence():
    data = request.get_json(force=True) or {}
    presence = data.get('presence', 'Available')

    conn = get_db()
    cur = conn.cursor()
    # Update the dir_people row for this user (match by user_id link or name)
    cur.execute(
        "UPDATE dir_people SET presence = %s WHERE tenant_id = %s AND id = (SELECT MIN(id) FROM dir_people WHERE tenant_id = %s)",
        (presence, g.tenant_id, g.tenant_id),
    )
    _log(cur, g.tenant_id, f"Presence set to {presence}")
    conn.commit()
    conn.close()
    return jsonify(presence)


# ---------------------------------------------------------------------------
# Seed — populate tables with demo data on first call if empty
# ---------------------------------------------------------------------------

@directory_bp.route('/seed', methods=['POST'])
def seed_data():
    """Insert demo data into directory tables if they're empty."""
    conn = get_db()
    cur = conn.cursor()
    tid = g.tenant_id

    cur.execute('SELECT COUNT(*) AS n FROM dir_people WHERE tenant_id = %s', (tid,))
    if cur.fetchone()['n'] > 0:
        conn.close()
        return jsonify({'ok': True, 'message': 'already seeded'})

    # People
    people = [
        ('Faisal Khan', 'Platform Owner', 'IT', 'HQ (London)', 'London HQ', 'fkhan@mcmgroup.com', '+44 20 7946 1001', '1001', 'Available', 'WebRTC softphone', '—', 'CX 3', 'Europe/London', '04 Jan 2024', ['Billing'], ['English'], []),
        ('Aisha Rahman', 'Contact Centre Manager', 'Operations', 'UK Retail', 'Manchester', 'arahman@mcmgroup.com', '+44 161 496 7100', '7100', 'On queue', 'WebRTC softphone', 'Faisal Khan', 'CX 3', 'Europe/London', '03 Feb 2024', ['Retention', 'Complaints'], ['English'], ['Retail Voice', 'Escalations']),
        ('Daniel Moore', 'Team Leader', 'Customer Care', 'UK Retail', 'Manchester', 'dmoore@mcmgroup.com', '+44 161 496 7112', '7112', 'Busy', 'WebRTC softphone', 'Aisha Rahman', 'CX 2', 'Europe/London', '19 Mar 2024', ['Billing', 'Retention'], ['English'], ['Retail Voice']),
        ('Sofia Petrova', 'Advisor', 'Customer Care', 'UK Retail', 'Manchester', 'spetrova@mcmgroup.com', '+44 161 496 7141', '7141', 'On queue', 'WebRTC softphone', 'Daniel Moore', 'CX 2', 'Europe/London', '12 Jan 2025', ['Technical Support'], ['English', 'Spanish'], ['Retail Voice', 'Tech Support']),
        ("James O'Neill", 'Advisor', 'Customer Care', 'UK Retail', 'Manchester', 'joneill@mcmgroup.com', '+44 161 496 7148', '7148', 'Available', 'Desk phone', 'Daniel Moore', 'CX 2', 'Europe/London', '02 Feb 2025', ['Billing'], ['English'], ['Retail Voice']),
        ('Meera Kapoor', 'Advisor', 'Collections', 'UK Collections', 'Mumbai Hub', 'mkapoor@mcmgroup.com', '+91 22 6100 2001', '2001', 'Away', 'Remote number', 'Aisha Rahman', 'CX 1', 'Asia/Kolkata', '20 Jan 2025', ['Collections'], ['English', 'Hindi'], ['Collections']),
        ('Tom Wright', 'Telephony Engineer', 'IT', 'HQ (London)', 'London HQ', 'twright@mcmgroup.com', '+44 20 7946 7000', '7000', 'Available', 'WebRTC softphone', 'Faisal Khan', 'CX 1', 'Europe/London', '14 Jan 2024', ['Technical Support'], ['English'], []),
        ('Lucy Bennett', 'WFM Analyst', 'Planning', 'HQ (London)', 'London HQ', 'lbennett@mcmgroup.com', '+44 20 7946 7311', '7311', 'Busy', 'WebRTC softphone', 'Faisal Khan', 'CX 3', 'Europe/London', '04 Apr 2024', ['Forecasting'], ['English'], []),
        ('Ravi Sharma', 'Advisor', 'Digital', 'UK Digital', 'Mumbai Hub', 'rsharma@mcmgroup.com', '+91 22 6100 2044', '2044', 'Offline', 'Remote number', 'Aisha Rahman', 'CX 2', 'Asia/Kolkata', '11 Jun 2026', ['Technical Support'], ['English', 'Hindi'], ['Digital Chat']),
        ('Helen Chase', 'Receptionist', 'Facilities', 'HQ (London)', 'London HQ', 'hchase@mcmgroup.com', '+44 20 7946 1000', '1000', 'Offline', 'Desk phone', 'Faisal Khan', 'Communicate', 'Europe/London', '22 Feb 2024', [], ['English'], []),
    ]
    for p in people:
        cur.execute(
            """INSERT INTO dir_people (tenant_id, name, title, dept, division, location,
               email, phone, ext, presence, station, manager, licence, tz, started,
               skills, langs, queues)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
            (tid, *p),
        )

    # Groups
    groups = [
        ('Customer Care Supervisors', 'Official', '7100', 'Broadcast', 'Aisha Rahman', True),
        ('Retail Advisors', 'Official', '—', 'Sequential', 'Daniel Moore', False),
        ('Collections Team', 'Official', '7200', 'Rotary', 'Meera Kapoor', True),
        ('Spanish Speakers', 'Skill expression', '—', 'Broadcast', 'System', False),
        ('IT Service Desk', 'Official', '7000', 'Sequential', 'Tom Wright', True),
        ('Social Committee', 'Social', '—', 'Broadcast', 'Helen Chase', False),
    ]
    for g_row in groups:
        cur.execute(
            """INSERT INTO dir_groups (tenant_id, name, type, ext, ring, owner, voicemail)
               VALUES (%s,%s,%s,%s,%s,%s,%s)""",
            (tid, *g_row),
        )

    # Locations
    locations = [
        ('London HQ', 'Head office', '18 Finsbury Circus, London EC2M 7EA', 'United Kingdom', 'Europe/London', '08:00 – 18:30', ['Ground — Reception', '3rd — CX Operations', '4th — IT & Planning'], '+44 20 7946 1099', 'Site-EU-LON-01', 'Operational'),
        ('Manchester', 'Contact centre', 'Kestrel House, 12 Deansgate, Manchester M3 2BW', 'United Kingdom', 'Europe/London', '07:00 – 22:00', ['1st — Retail Voice', '2nd — Collections'], '+44 161 496 7099', 'Site-EU-MAN-02', 'Operational'),
        ('Mumbai Hub', 'Delivery centre', 'Tower B, Nirlon Knowledge Park, Goregaon, Mumbai 400063', 'India', 'Asia/Kolkata', '24 / 7', ['7th — Digital', '8th — Collections'], '+91 22 6100 2099', 'Site-AP-BOM-01', 'Operational'),
        ('Partner — Manila', 'Outsourced overflow', 'Cyber Sigma, Lawton Ave, Taguig 1630', 'Philippines', 'Asia/Manila', '24 / 7', ['12th — Overflow voice'], '+63 2 8555 0099', 'Site-AP-MNL-03', 'Limited'),
    ]
    for loc in locations:
        cur.execute(
            """INSERT INTO dir_locations (tenant_id, name, type, address, country, tz,
               hours, floors, emergency, site, status)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
            (tid, *loc),
        )

    # Profile fields
    fields = [
        ('Job title', 'title', 'Text', 'Work', 'Everyone', True, True),
        ('Department', 'department', 'Select', 'Work', 'Everyone', True, True),
        ('Extension', 'extension', 'Number', 'Contact', 'Everyone', True, True),
        ('Mobile', 'mobile', 'Phone', 'Contact', 'Managers only', False, False),
        ('Start date', 'start_date', 'Date', 'Work', 'Managers only', False, False),
        ('Languages', 'languages', 'Multi-select', 'Skills', 'Everyone', False, False),
        ('Certifications', 'certifications', 'Multi-select', 'Skills', 'Everyone', False, False),
        ('Emergency contact', 'emergency_contact', 'Text', 'Private', 'HR only', False, False),
        ('About me', 'bio', 'Long text', 'Personal', 'Everyone', False, False),
    ]
    for f in fields:
        cur.execute(
            """INSERT INTO dir_profile_fields (tenant_id, label, key, type, section,
               visibility, required, system)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s)""",
            (tid, *f),
        )

    # External contacts
    externals = [
        ('Priya Nair', 'BT Wholesale', 'SIP carrier account manager', 'priya.nair@btwholesale.com', '+44 20 7356 4410', 'Carrier', '12 Aug 2026', 'Tom Wright'),
        ('Mark Ellis', 'Northstar BPO', 'Delivery director', 'mellis@northstarbpo.com', '+63 2 8555 0121', 'Partner', '05 Aug 2026', 'Aisha Rahman'),
        ('Sara Duarte', 'Cloudline Partners', 'Implementation lead', 'sduarte@cloudline.io', '+353 1 545 8890', 'Vendor', '28 Jul 2026', 'Faisal Khan'),
        ('Ian Whitfield', 'Vertex Consulting', 'WFM consultant', 'ian.w@vertexconsulting.co.uk', '+44 113 322 7761', 'Vendor', '14 Jun 2026', 'Lucy Bennett'),
        ('Elena Rossi', 'MCM Retail Ireland', 'Ops manager (trustee org)', 'erossi@mcmretail.ie', '+353 1 902 3344', 'Group company', '02 Aug 2026', 'Aisha Rahman'),
    ]
    for ext in externals:
        cur.execute(
            """INSERT INTO dir_external_contacts (tenant_id, name, org, role, email,
               phone, relationship, last_contact, owner)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
            (tid, *ext),
        )

    # Workspaces
    workspaces = [
        ('Contact Centre Playbooks', 'Team', 'Aisha Rahman', 'Customer Care Supervisors', 128, '1.4 GB', '14 Aug 2026', '3 years'),
        ('Telephony Runbooks', 'Team', 'Tom Wright', 'IT Service Desk', 64, '820 MB', '11 Aug 2026', '5 years'),
        ('HR & Onboarding', 'Restricted', 'Helen Chase', 'HR only', 212, '3.1 GB', '09 Aug 2026', '7 years'),
        ('Quality Calibration', 'Team', 'Lucy Bennett', 'Quality Evaluators', 47, '410 MB', '02 Aug 2026', '2 years'),
        ('Company Announcements', 'Public', 'Faisal Khan', 'Everyone', 39, '190 MB', '18 Aug 2026', '1 year'),
    ]
    for ws in workspaces:
        cur.execute(
            """INSERT INTO dir_workspaces (tenant_id, name, type, owner, access, docs,
               size, updated, retention)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
            (tid, *ws),
        )

    conn.commit()
    conn.close()
    return jsonify({'ok': True, 'message': 'directory seeded'}), 201
