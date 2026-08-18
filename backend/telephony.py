"""
Real telephony (Twilio) — layered on top of the existing interactions/
messages tables so a real SMS/WhatsApp/call shows up in the same "My
interactions" UI as a simulated one, not a separate system.

Nothing here runs until the TWILIO_* env vars are set (config.py leaves
them optional so the app keeps booting without a Twilio account) — every
route checks _configured() first and returns a clear 503 otherwise.

Voice calls use click-to-call: Twilio rings the agent's own phone first,
and once they pick up, dials the customer and bridges the two legs. This
is the standard way to get a real phone call in and out of a browser app
without embedding the Twilio Voice JS SDK (which would need Access Tokens
and real browser mic/speaker permissions — a bigger follow-up, not built
here). Real *inbound* calls (a customer dialling in and ringing a live
agent) need that same SDK to actually ring a browser tab, so that
direction isn't built yet either — only outbound click-to-call is real.
"""

from datetime import datetime, timezone
from flask import Blueprint, jsonify, request, g
from twilio.rest import Client
from twilio.request_validator import RequestValidator
from twilio.twiml.voice_response import VoiceResponse
from twilio.twiml.messaging_response import MessagingResponse

from db import get_db
import config

telephony_bp = Blueprint('telephony', __name__)

# Twilio posts here — it can't send our bearer token, so these three are
# public (see auth.py's PUBLIC_PATHS). Authenticity is checked instead via
# Twilio's own request signature (_verify_twilio_signature).
PUBLIC_TELEPHONY_PATHS = (
    '/api/telephony/sms-webhook',
    '/api/telephony/voice-webhook',
    '/api/telephony/status-webhook',
)


def _configured():
    return bool(config.TWILIO_ACCOUNT_SID and config.TWILIO_AUTH_TOKEN and config.TWILIO_FROM_NUMBER)


def _client():
    return Client(config.TWILIO_ACCOUNT_SID, config.TWILIO_AUTH_TOKEN)


def _verify_twilio_signature():
    validator = RequestValidator(config.TWILIO_AUTH_TOKEN)
    signature = request.headers.get('X-Twilio-Signature', '')
    return validator.validate(request.url, request.form, signature)


@telephony_bp.route('/api/telephony/status')
def telephony_status():
    return jsonify({'configured': _configured(), 'whatsapp_configured': bool(config.TWILIO_WHATSAPP_FROM)})


@telephony_bp.route('/api/telephony/sms', methods=['POST'])
def send_sms():
    """Agent starts a new real SMS/WhatsApp conversation."""
    if not _configured():
        return jsonify({'ok': False, 'error': 'Twilio not configured'}), 503

    data = request.get_json(force=True) or {}
    to = data.get('to')
    body = data.get('body')
    channel = data.get('channel', 'SMS')  # 'SMS' | 'WhatsApp'
    if not to or not body:
        return jsonify({'ok': False, 'error': 'to and body required'}), 400

    from_number = config.TWILIO_WHATSAPP_FROM if channel == 'WhatsApp' else config.TWILIO_FROM_NUMBER
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

    try:
        msg = _client().messages.create(
            to=('whatsapp:' + to) if channel == 'WhatsApp' else to,
            from_=from_number,
            body=body,
        )
    except Exception as e:
        conn.rollback()
        conn.close()
        return jsonify({'ok': False, 'error': str(e)}), 502

    cur.execute(
        'INSERT INTO messages (interaction_id, from_agent, body, complete) VALUES (%s, true, %s, false)',
        (interaction['id'], body),
    )
    cur.execute('UPDATE interactions SET provider_sid = %s WHERE id = %s', (msg.sid, interaction['id']))
    conn.commit()
    conn.close()
    return jsonify({'ok': True, 'interaction_id': interaction['id'], 'message_sid': msg.sid}), 201


@telephony_bp.route('/api/telephony/sms/<uuid:interaction_id>/reply', methods=['POST'])
def reply_sms(interaction_id):
    """Agent sends a follow-up in an existing real SMS/WhatsApp thread."""
    if not _configured():
        return jsonify({'ok': False, 'error': 'Twilio not configured'}), 503

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
    from_number = config.TWILIO_WHATSAPP_FROM if is_whatsapp else config.TWILIO_FROM_NUMBER
    to = ('whatsapp:' + interaction['dnis']) if is_whatsapp else interaction['dnis']

    try:
        msg = _client().messages.create(to=to, from_=from_number, body=body)
    except Exception as e:
        conn.close()
        return jsonify({'ok': False, 'error': str(e)}), 502

    cur.execute(
        'INSERT INTO messages (interaction_id, from_agent, body, complete) VALUES (%s, true, %s, false)',
        (str(interaction_id), body),
    )
    conn.commit()
    conn.close()
    return jsonify({'ok': True, 'message_sid': msg.sid})


@telephony_bp.route('/api/telephony/sms-webhook', methods=['POST'])
def sms_webhook():
    """Twilio calls this when a real SMS/WhatsApp message arrives inbound."""
    if _configured() and not _verify_twilio_signature():
        return ('Invalid signature', 403)

    raw_from = request.form.get('From', '')
    body = request.form.get('Body', '')
    is_whatsapp = raw_from.startswith('whatsapp:')
    channel = 'WhatsApp' if is_whatsapp else 'SMS'
    clean_from = raw_from.replace('whatsapp:', '')

    conn = get_db()
    cur = conn.cursor()
    cur.execute('SELECT id FROM tenants WHERE name = %s', (config.DEFAULT_TENANT,))
    tenant = cur.fetchone()

    cur.execute(
        "INSERT INTO interactions (tenant_id, direction, media, ani, result) VALUES (%s,'inbound',%s,%s,'Active') RETURNING id",
        (tenant['id'], channel, clean_from),
    )
    interaction = cur.fetchone()
    cur.execute(
        'INSERT INTO messages (interaction_id, from_agent, body, complete) VALUES (%s, false, %s, false)',
        (interaction['id'], body),
    )
    conn.commit()
    conn.close()

    return str(MessagingResponse()), 200, {'Content-Type': 'text/xml'}


@telephony_bp.route('/api/telephony/call', methods=['POST'])
def outbound_call():
    """Click-to-call: rings agent_phone first; once answered, dials `to`
    and bridges the two legs. agent_phone has no persisted field yet, so
    the agent types it in each time (see the dial pad's real-call prompt)."""
    if not _configured():
        return jsonify({'ok': False, 'error': 'Twilio not configured'}), 503

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

    bridge_url = f"{config.PUBLIC_BASE_URL}/api/telephony/voice-webhook?to={customer_number}"
    status_url = f"{config.PUBLIC_BASE_URL}/api/telephony/status-webhook?interaction_id={interaction_id}"

    try:
        call = _client().calls.create(
            to=agent_phone,
            from_=config.TWILIO_FROM_NUMBER,
            url=bridge_url,
            status_callback=status_url,
            status_callback_event=['answered', 'completed'],
        )
    except Exception as e:
        conn.rollback()
        conn.close()
        return jsonify({'ok': False, 'error': str(e)}), 502

    cur.execute('UPDATE interactions SET provider_sid = %s WHERE id = %s', (call.sid, interaction_id))
    conn.commit()
    conn.close()
    return jsonify({'ok': True, 'interaction_id': interaction_id, 'call_sid': call.sid}), 201


@telephony_bp.route('/api/telephony/voice-webhook', methods=['POST'])
def voice_webhook():
    """Twilio calls this once the agent's leg connects; bridges to the customer."""
    if _configured() and not _verify_twilio_signature():
        return ('Invalid signature', 403)
    to = request.args.get('to', '')
    resp = VoiceResponse()
    resp.say('Connecting your call now.')
    if to:
        resp.dial(to)
    return str(resp), 200, {'Content-Type': 'text/xml'}


@telephony_bp.route('/api/telephony/status-webhook', methods=['POST'])
def status_webhook():
    """Twilio call-status callback — marks the interaction answered/ended."""
    if _configured() and not _verify_twilio_signature():
        return ('Invalid signature', 403)

    interaction_id = request.args.get('interaction_id')
    call_status = request.form.get('CallStatus')
    if not interaction_id:
        return ('', 204)

    conn = get_db()
    cur = conn.cursor()
    now = datetime.now(timezone.utc)
    if call_status == 'in-progress':
        cur.execute(
            'UPDATE interactions SET answered_at = %s WHERE id = %s AND answered_at IS NULL',
            (now, interaction_id),
        )
    elif call_status in ('completed', 'busy', 'no-answer', 'failed', 'canceled'):
        cur.execute(
            "UPDATE interactions SET ended_at = %s, result = %s WHERE id = %s AND ended_at IS NULL",
            (now, 'Handled' if call_status == 'completed' else 'Abandoned', interaction_id),
        )
    conn.commit()
    conn.close()
    return ('', 204)
