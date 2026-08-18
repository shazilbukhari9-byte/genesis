"""
Real telephony (Telnyx) — layered on top of the existing interactions/
messages tables so a real SMS/WhatsApp/call shows up in the same "My
interactions" UI as a simulated one, not a separate system.

Nothing here runs until the TELNYX_* env vars are set (config.py leaves
them optional so the app keeps booting without a Telnyx account) — every
route checks _configured() first and returns a clear 503 otherwise.

Telnyx's Voice product is Call Control (webhook-driven), not TwiML —
there's no single declarative response. Click-to-call outbound voice
works like this: dial() rings the agent's own phone; when Telnyx posts
the call.answered event for that leg to voice_webhook, we immediately
call actions.transfer() on that same call_control_id to dial the
customer number and bridge the two legs together. call.hangup on either
leg closes out the interaction.

Real *inbound* calls (a customer dialling in and ringing a live agent's
browser) need the Telnyx WebRTC SDK to actually ring a browser tab, so
that direction isn't built yet — only outbound click-to-call is real.
"""

import base64
from datetime import datetime, timezone
from flask import Blueprint, jsonify, request, g
from telnyx import Telnyx
from nacl.signing import VerifyKey
from nacl.exceptions import BadSignatureError

from db import get_db
import config

telephony_bp = Blueprint('telephony', __name__)

# Telnyx posts here — it can't send our bearer token, so these two are
# public (see auth.py's PUBLIC_PATHS). Authenticity is checked instead via
# Telnyx's own Ed25519 webhook signature (_verify_telnyx_signature).
PUBLIC_TELEPHONY_PATHS = (
    '/api/telephony/sms-webhook',
    '/api/telephony/voice-webhook',
)


def _configured():
    return bool(config.TELNYX_API_KEY and config.TELNYX_FROM_NUMBER)


def _client():
    return Telnyx(api_key=config.TELNYX_API_KEY)


def _verify_telnyx_signature():
    sig_b64 = request.headers.get('Telnyx-Signature-Ed25519', '')
    ts = request.headers.get('Telnyx-Timestamp', '')
    if not sig_b64 or not ts or not config.TELNYX_PUBLIC_KEY:
        return False
    try:
        verify_key = VerifyKey(base64.b64decode(config.TELNYX_PUBLIC_KEY))
        signed_payload = ts.encode() + b'|' + request.get_data()
        verify_key.verify(signed_payload, base64.b64decode(sig_b64))
        return True
    except (BadSignatureError, Exception):
        return False


@telephony_bp.route('/api/telephony/status')
def telephony_status():
    return jsonify({'configured': _configured(), 'whatsapp_configured': bool(config.TELNYX_WHATSAPP_FROM)})


@telephony_bp.route('/api/telephony/sms', methods=['POST'])
def send_sms():
    """Agent starts a new real SMS/WhatsApp conversation."""
    if not _configured():
        return jsonify({'ok': False, 'error': 'Telnyx not configured'}), 503

    data = request.get_json(force=True) or {}
    to = data.get('to')
    body = data.get('body')
    channel = data.get('channel', 'SMS')  # 'SMS' | 'WhatsApp'
    if not to or not body:
        return jsonify({'ok': False, 'error': 'to and body required'}), 400

    from_number = config.TELNYX_WHATSAPP_FROM if channel == 'WhatsApp' else config.TELNYX_FROM_NUMBER
    if not from_number:
        return jsonify({'ok': False, 'error': f'no {channel} sender number configured'}), 503

    conn = get_db()
    cur = conn.cursor()
    cur.execute(
        """
        INSERT INTO interactions
          (tenant_id, direction, media, dnis, agent_id, agent_name, answered_at, result)
        VALUES (%s,'outbound',%s,%s,%s,%s, now(), 'Active')
        RETURNING id
        """,
        (g.tenant_id, channel, to, g.user_id, g.user_name),
    )
    interaction = cur.fetchone()

    client = _client()
    try:
        if channel == 'WhatsApp':
            # Free-text only works inside an existing 24h customer-service
            # window (i.e. the customer messaged first); a cold outbound
            # WhatsApp message needs a pre-approved template instead — not
            # handled here, matching this module's "simple case only" scope.
            resp = client.messages.whatsapp(
                from_=from_number, to=to,
                whatsapp_message={'type': 'text', 'text': {'body': body}},
            )
        else:
            resp = client.messages.send(from_=from_number, to=to, text=body)
    except Exception as e:
        conn.rollback()
        conn.close()
        return jsonify({'ok': False, 'error': str(e)}), 502

    message_id = getattr(getattr(resp, 'data', resp), 'id', None)
    cur.execute(
        'INSERT INTO messages (interaction_id, from_agent, body, complete) VALUES (%s, true, %s, false)',
        (interaction['id'], body),
    )
    cur.execute('UPDATE interactions SET provider_sid = %s WHERE id = %s', (message_id, interaction['id']))
    conn.commit()
    conn.close()
    return jsonify({'ok': True, 'interaction_id': interaction['id'], 'message_id': message_id}), 201


@telephony_bp.route('/api/telephony/sms/<uuid:interaction_id>/reply', methods=['POST'])
def reply_sms(interaction_id):
    """Agent sends a follow-up in an existing real SMS/WhatsApp thread."""
    if not _configured():
        return jsonify({'ok': False, 'error': 'Telnyx not configured'}), 503

    data = request.get_json(force=True) or {}
    body = data.get('body')
    if not body:
        return jsonify({'ok': False, 'error': 'body required'}), 400

    conn = get_db()
    cur = conn.cursor()
    cur.execute('SELECT * FROM interactions WHERE id = %s', (str(interaction_id),))
    interaction = cur.fetchone()
    if interaction is None:
        conn.close()
        return jsonify({'ok': False, 'error': 'not found'}), 404

    is_whatsapp = interaction['media'] == 'WhatsApp'
    from_number = config.TELNYX_WHATSAPP_FROM if is_whatsapp else config.TELNYX_FROM_NUMBER
    to = interaction['dnis']

    client = _client()
    try:
        if is_whatsapp:
            resp = client.messages.whatsapp(
                from_=from_number, to=to,
                whatsapp_message={'type': 'text', 'text': {'body': body}},
            )
        else:
            resp = client.messages.send(from_=from_number, to=to, text=body)
    except Exception as e:
        conn.close()
        return jsonify({'ok': False, 'error': str(e)}), 502

    message_id = getattr(getattr(resp, 'data', resp), 'id', None)
    cur.execute(
        'INSERT INTO messages (interaction_id, from_agent, body, complete) VALUES (%s, true, %s, false)',
        (str(interaction_id), body),
    )
    conn.commit()
    conn.close()
    return jsonify({'ok': True, 'message_id': message_id})


@telephony_bp.route('/api/telephony/sms-webhook', methods=['POST'])
def sms_webhook():
    """Telnyx calls this when a real SMS/WhatsApp message arrives inbound."""
    if _configured() and not _verify_telnyx_signature():
        return ('Invalid signature', 403)

    body = request.get_json(silent=True) or {}
    event = body.get('data', {})
    if event.get('event_type') != 'message.received':
        return ('', 204)

    payload = event.get('payload', {})
    raw_from = (payload.get('from') or {}).get('phone_number', '')
    text = payload.get('text', '') or ''
    channel = 'WhatsApp' if payload.get('type') == 'WHATSAPP' else 'SMS'

    conn = get_db()
    cur = conn.cursor()
    cur.execute('SELECT id FROM tenants WHERE name = %s', (config.DEFAULT_TENANT,))
    tenant = cur.fetchone()

    cur.execute(
        "INSERT INTO interactions (tenant_id, direction, media, ani, result) VALUES (%s,'inbound',%s,%s,'Active') RETURNING id",
        (tenant['id'], channel, raw_from),
    )
    interaction = cur.fetchone()
    cur.execute(
        'INSERT INTO messages (interaction_id, from_agent, body, complete) VALUES (%s, false, %s, false)',
        (interaction['id'], text),
    )
    conn.commit()
    conn.close()
    return ('', 204)


@telephony_bp.route('/api/telephony/call', methods=['POST'])
def outbound_call():
    """Click-to-call: rings agent_phone first; once Telnyx reports that leg
    as answered (see voice_webhook), transfers/bridges it to `to`."""
    if not _configured() or not config.TELNYX_CONNECTION_ID:
        return jsonify({'ok': False, 'error': 'Telnyx not configured'}), 503

    data = request.get_json(force=True) or {}
    agent_phone = data.get('agent_phone')
    customer_number = data.get('to')
    if not agent_phone or not customer_number:
        return jsonify({'ok': False, 'error': 'agent_phone and to required'}), 400

    conn = get_db()
    cur = conn.cursor()
    cur.execute(
        """
        INSERT INTO interactions (tenant_id, direction, media, dnis, agent_id, agent_name, result)
        VALUES (%s,'outbound','Voice',%s,%s,%s,'Active') RETURNING id
        """,
        (g.tenant_id, customer_number, g.user_id, g.user_name),
    )
    interaction = cur.fetchone()
    interaction_id = str(interaction['id'])

    webhook_url = f"{config.PUBLIC_BASE_URL}/api/telephony/voice-webhook?interaction_id={interaction_id}&bridge_to={customer_number}"

    try:
        resp = _client().calls.dial(
            connection_id=config.TELNYX_CONNECTION_ID,
            to=agent_phone,
            from_=config.TELNYX_FROM_NUMBER,
            webhook_url=webhook_url,
        )
    except Exception as e:
        conn.rollback()
        conn.close()
        return jsonify({'ok': False, 'error': str(e)}), 502

    call_control_id = resp.data.call_control_id
    cur.execute('UPDATE interactions SET provider_sid = %s WHERE id = %s', (call_control_id, interaction_id))
    conn.commit()
    conn.close()
    return jsonify({'ok': True, 'interaction_id': interaction_id, 'call_control_id': call_control_id}), 201


@telephony_bp.route('/api/telephony/voice-webhook', methods=['POST'])
def voice_webhook():
    """Telnyx Call Control events for the agent's leg — bridges to the
    customer on answer, closes out the interaction on hangup."""
    if _configured() and not _verify_telnyx_signature():
        return ('Invalid signature', 403)

    body = request.get_json(silent=True) or {}
    event = body.get('data', {})
    event_type = event.get('event_type')
    payload = event.get('payload', {})
    call_control_id = payload.get('call_control_id')
    interaction_id = request.args.get('interaction_id')
    bridge_to = request.args.get('bridge_to')

    conn = get_db()
    cur = conn.cursor()
    now = datetime.now(timezone.utc)

    if event_type == 'call.answered' and call_control_id and bridge_to:
        try:
            _client().calls.actions.transfer(call_control_id, to=bridge_to)
        except Exception:
            pass
        if interaction_id:
            cur.execute(
                'UPDATE interactions SET answered_at = %s WHERE id = %s AND answered_at IS NULL',
                (now, interaction_id),
            )
    elif event_type == 'call.hangup' and interaction_id:
        cur.execute(
            "UPDATE interactions SET ended_at = %s, result = 'Handled' WHERE id = %s AND ended_at IS NULL",
            (now, interaction_id),
        )
    conn.commit()
    conn.close()
    return ('', 204)
