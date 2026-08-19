"""
Organization Settings backend — matches src/features/org-settings/
orgSettingsService.ts exactly: fetchOrgSettings() and updateOrgSetting()
are the only two operations the UI ever calls. Stored as one JSONB
document per tenant (categories of key/value settings), not a normalised
table, since that's the natural shape of the data itself.
"""

from datetime import datetime, timezone
from flask import Blueprint, jsonify, request, g

from db import get_db

org_settings_bp = Blueprint('org_settings', __name__)


def _default_settings():
    return {
        "general": [
            {"key": "Organization name", "value": "MCM Group PLC", "type": "text"},
            {"key": "Short name", "value": "mcmgroup", "type": "locked",
             "hint": "Login identifier — cannot be changed after creation"},
            {"key": "Organization ID", "value": "8f14e45f-ceea-4d3b-9c7f-2b1a0d7e33aa", "type": "locked",
             "hint": "Give this to Customer Care when raising tickets"},
            {"key": "Home region", "value": "EU (London) — euw2", "type": "locked", "hint": "Set at org creation"},
            {"key": "Default country code", "value": "+44 (United Kingdom)", "type": "select",
             "options": ["+44 (United Kingdom)", "+1 (United States)", "+91 (India)", "+353 (Ireland)", "+65 (Singapore)"]},
            {"key": "Default language", "value": "English (United Kingdom)", "type": "select",
             "options": ["English (United Kingdom)", "English (United States)", "Hindi", "Spanish", "French"]},
            {"key": "Time zone", "value": "Europe/London", "type": "select",
             "options": ["Europe/London", "Europe/Dublin", "Asia/Kolkata", "America/New_York", "UTC"]},
            {"key": "Date / time format", "value": "DD/MM/YYYY · 24 hour", "type": "select",
             "options": ["DD/MM/YYYY · 24 hour", "MM/DD/YYYY · 12 hour", "YYYY-MM-DD · 24 hour"]},
        ],
        "security": [
            {"key": "Minimum password length", "value": 12, "type": "number", "hint": "Genesys default minimum is 8"},
            {"key": "Password expiry (days)", "value": 90, "type": "number"},
            {"key": "Password history (previous passwords blocked)", "value": 10, "type": "number"},
            {"key": "Session idle timeout (minutes)", "value": 60, "type": "number"},
            {"key": "Require multi-factor authentication", "value": True, "type": "toggle",
             "hint": "Applies to native logins; SSO users authenticate at the IdP"},
            {"key": "Enforce SSO only (disable native passwords)", "value": False, "type": "toggle"},
            {"key": "Allow MCM Care support access to configuration", "value": True, "type": "toggle"},
            {"key": "Trusted IP ranges", "value": "194.60.0.0/16, 10.20.0.0/16", "type": "text"},
        ],
        "branding": [
            {"key": "Use custom logo in agent UI", "value": True, "type": "toggle"},
            {"key": "Theme", "value": "MCM Navy", "type": "select", "options": ["MCM Navy", "Light", "Dark", "High contrast"]},
            {"key": "Accent colour", "value": "#FF4F1F", "type": "text"},
            {"key": "Login page message", "value": "Welcome to MCM Cloud CX", "type": "text"},
        ],
        "residency": [
            {"key": "Core region (org home)", "value": "EU (London) — euw2", "type": "locked"},
            {"key": "Preferred media region", "value": "EU (London)", "type": "select",
             "options": ["EU (London)", "EU (Frankfurt)", "Asia (Mumbai)", "US East"]},
            {"key": "Call recording storage", "value": "EU (London)", "type": "locked",
             "hint": "Recordings stay in-region for UK-GDPR"},
            {"key": "Transcript & analytics storage", "value": "EU (London)", "type": "locked"},
        ],
        "beta": [
            {"key": "Agent Copilot summaries", "value": True, "type": "toggle", "hint": "AI wrap-up summaries after each call"},
            {"key": "New analytics workspace", "value": True, "type": "toggle"},
            {"key": "WebRTC codec v2 (Opus FEC)", "value": False, "type": "toggle"},
            {"key": "Predictive routing pilot", "value": False, "type": "toggle",
             "hint": "AI-matched agent selection on eligible queues"},
        ],
    }


@org_settings_bp.route('/api/org-settings')
def fetch_org_settings():
    tenant_id = g.tenant_id

    conn = get_db()
    cur = conn.cursor()
    cur.execute('SELECT data FROM org_settings WHERE tenant_id = %s', (tenant_id,))
    row = cur.fetchone()

    if row is None:
        data = _default_settings()
        cur.execute('INSERT INTO org_settings (tenant_id, data) VALUES (%s, %s)', (tenant_id, data))
        conn.commit()
    else:
        data = row['data']

    conn.close()
    return jsonify(data)


@org_settings_bp.route('/api/org-settings', methods=['PATCH'])
def update_org_setting():
    body = request.get_json(force=True) or {}
    tenant_id = g.tenant_id
    category = body.get('category')
    index = body.get('index')
    value = body.get('value')
    changed_by = g.user_name

    if category is None or index is None:
        return jsonify({'ok': False, 'error': 'category and index required'}), 400

    conn = get_db()
    cur = conn.cursor()
    cur.execute('SELECT data FROM org_settings WHERE tenant_id = %s', (tenant_id,))
    row = cur.fetchone()
    data = row['data'] if row else _default_settings()

    settings_list = data.get(category)
    if settings_list is None or index >= len(settings_list):
        conn.close()
        return jsonify({'ok': False, 'error': 'unknown category or index'}), 404

    settings_list[index]['value'] = value
    settings_list[index]['lastChangedAt'] = datetime.now(timezone.utc).isoformat()
    settings_list[index]['lastChangedBy'] = changed_by

    cur.execute(
        """
        INSERT INTO org_settings (tenant_id, data, updated_at) VALUES (%s, %s, now())
        ON CONFLICT (tenant_id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()
        """,
        (tenant_id, data),
    )
    conn.commit()
    conn.close()
    return jsonify(data)
