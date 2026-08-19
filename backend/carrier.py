"""
Carrier layer (Section 11) — the parts that don't need a real Twilio
account: number normalisation, BYOC trunk resolution, and call-route
matching. Webhook signature verification, live conferencing, and the
JWT/webhook auth split are all real-Twilio-account behavior and aren't
built here.
"""

import re
from flask import Blueprint, jsonify, request, g

from db import get_db

carrier_bp = Blueprint('carrier', __name__)


# ---------------------------------------------------------------------------
# Number normalisation
# ---------------------------------------------------------------------------

def normalise_dialled(raw, default_dial_prefix):
    """
    Converts what an agent typed into E.164, returning (number, error)
    rather than guessing. A bare national number gets the tenant's
    default_dial_prefix prepended (Twilio otherwise assumes +1, which
    silently turns e.g. an Indian number into an invalid US one); a
    leading national trunk zero is stripped once the country code is on.
    Length is validated at 8-15 digits, matching E.164's own limits.
    """
    if not raw:
        return None, 'empty number'

    digits = re.sub(r'[^0-9+]', '', raw.strip())

    if digits.startswith('+'):
        number = digits
    else:
        digits = digits.lstrip('0')  # strip a national trunk zero
        number = '+' + default_dial_prefix + digits

    digit_count = len(re.sub(r'\D', '', number))
    if not (8 <= digit_count <= 15):
        return None, f'expected 8-15 digits, got {digit_count}'

    return number, None


@carrier_bp.route('/api/carrier/normalise', methods=['POST'])
def normalise_endpoint():
    data = request.get_json(force=True) or {}
    raw = data.get('number')
    if not raw:
        return jsonify({'ok': False, 'error': 'number required'}), 400

    conn = get_db()
    cur = conn.cursor()
    cur.execute('SELECT default_dial_prefix FROM tenants WHERE id = %s', (g.tenant_id,))
    row = cur.fetchone()
    conn.close()
    if row is None:
        return jsonify({'ok': False, 'error': 'unknown tenant'}), 404

    number, error = normalise_dialled(raw, row['default_dial_prefix'])
    if error:
        return jsonify({'ok': False, 'error': error}), 400
    return jsonify({'ok': True, 'number': number})


# ---------------------------------------------------------------------------
# BYOC trunk resolution
# ---------------------------------------------------------------------------

@carrier_bp.route('/api/byoc/route')
def byoc_route():
    """
    Resolves carrier preference: customer trunks in priority order, with
    the locked platform carrier always appended last, so a misconfigured
    customer trunk degrades to the platform rather than blackholing the
    call. Returns the chain as a trace with a reason per hop.
    """
    conn = get_db()
    cur = conn.cursor()
    cur.execute(
        'SELECT * FROM trunks WHERE tenant_id = %s AND is_platform = false ORDER BY priority, name',
        (g.tenant_id,),
    )
    customer_trunks = cur.fetchall()
    cur.execute(
        'SELECT * FROM trunks WHERE tenant_id = %s AND is_platform = true LIMIT 1',
        (g.tenant_id,),
    )
    platform_trunk = cur.fetchone()
    conn.close()

    trace = []
    for t in customer_trunks:
        trace.append({
            'trunk': t['name'],
            'priority': t['priority'],
            'reason': 'enabled, in priority order' if t['enabled'] else 'skipped: disabled',
            'usable': t['enabled'],
        })

    if platform_trunk:
        trace.append({
            'trunk': platform_trunk['name'],
            'priority': None,
            'reason': 'locked platform carrier — always last, guaranteed fallback',
            'usable': True,
        })
    else:
        trace.append({
            'trunk': None,
            'priority': None,
            'reason': 'no platform carrier configured for this tenant',
            'usable': False,
        })

    chosen = next((h['trunk'] for h in trace if h['usable']), None)
    return jsonify({'ok': True, 'chosen': chosen, 'trace': trace})


# ---------------------------------------------------------------------------
# Call route matching
# ---------------------------------------------------------------------------

def _route_matches(route, number):
    try:
        if route['match_type'] == 'exact':
            return number == route['pattern']
        if route['match_type'] == 'prefix':
            return number.startswith(route['pattern'])
        if route['match_type'] == 'regex':
            return re.match(route['pattern'], number) is not None
    except re.error:
        # a malformed regex returns "no match" rather than raising, so one
        # bad rule can't break resolution for every number
        return False
    return False


@carrier_bp.route('/api/call-routes/resolve')
def resolve_call_route():
    """
    Evaluates number patterns (exact / prefix / regex) in priority order;
    falls back to did_assignments if nothing matches.
    """
    number = request.args.get('number')
    if not number:
        return jsonify({'ok': False, 'error': 'number required'}), 400

    conn = get_db()
    cur = conn.cursor()
    cur.execute(
        'SELECT * FROM call_routes WHERE tenant_id = %s AND enabled = true ORDER BY priority, name',
        (g.tenant_id,),
    )
    routes = cur.fetchall()

    for route in routes:
        if _route_matches(route, number):
            conn.close()
            return jsonify({
                'ok': True,
                'matched': 'call_route',
                'route_name': route['name'],
                'destination_type': route['destination_type'],
                'flow_id': route['flow_id'],
                'queue_id': route['queue_id'],
                'user_id': route['user_id'],
                'external_number': route['external_number'],
            })

    cur.execute(
        'SELECT * FROM did_assignments WHERE tenant_id = %s AND phone_number = %s',
        (g.tenant_id, number),
    )
    did = cur.fetchone()
    conn.close()

    if did:
        return jsonify({
            'ok': True,
            'matched': 'did_assignment',
            'destination_type': did['destination_type'],
            'flow_id': did['flow_id'],
            'queue_id': did['queue_id'],
        })

    return jsonify({'ok': False, 'matched': None, 'error': 'no route or DID assignment found'}), 404
