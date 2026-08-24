"""
Configuration & secrets (Section 14). Secrets come from the environment
only. Raises ConfigError at import when a required one is missing, naming
both the variable and the file to set it in — a process that refuses to
start is far easier to diagnose than one that quietly connects with a
default credential or signs sessions with a key an attacker already knows.

Our own defaults (db name 'subscription', port 5433, app port 5000) are
kept instead of copying the doc's literal values (own_genesys/5432/4394)
— those are specific to their deployment, not ours. The pattern (env-var
driven, fail fast, sensible optional defaults) is what's being adopted.

Loads from backend/.env if present (gitignored — see .env.example for the
required keys) before falling back to real process environment variables,
so local dev doesn't need real env vars exported in the shell.
"""

import os


class ConfigError(Exception):
    pass


ENV_FILE = os.path.join(os.path.dirname(__file__), '.env')


def _load_dotenv(path):
    if not os.path.exists(path):
        return
    with open(path, 'r', encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith('#') or '=' not in line:
                continue
            key, _, value = line.partition('=')
            key = key.strip()
            value = value.strip().strip('"').strip("'")
            os.environ.setdefault(key, value)


_load_dotenv(ENV_FILE)


def _require(name):
    value = os.environ.get(name)
    if not value:
        raise ConfigError(
            f"{name} is required but not set. Add it to {ENV_FILE} "
            f"(see .env.example) or export it in the environment before starting."
        )
    return value


# --- required, no fallback ---
DB_PASSWORD = _require('OG_DB_PASSWORD')
SECRET_KEY = _require('OG_SECRET_KEY')

# --- optional, with our own project's defaults ---
DB_NAME = os.environ.get('OG_DB_NAME', 'subscription')
DB_USER = os.environ.get('OG_DB_USER', 'postgres')
DB_HOST = os.environ.get('OG_DB_HOST', 'localhost')
DB_PORT = os.environ.get('OG_DB_PORT', '5433')
TOKEN_TTL_HOURS = int(os.environ.get('OG_TOKEN_TTL_HOURS', '12'))
HOST = os.environ.get('OG_HOST', '127.0.0.1')
PORT = int(os.environ.get('OG_PORT', '5000'))
DEFAULT_TENANT = os.environ.get('OG_DEFAULT_TENANT', 'MCM Group')
PUBLIC_BASE_URL = os.environ.get('OG_PUBLIC_BASE_URL', f'http://{HOST}:{PORT}')

# Comma-separated list of allowed frontend origins for CORS. Defaults to the
# two origins this app has always shipped with (local Vite dev server +
# the deployed Vercel frontend) so existing deployments keep working with
# no config change; a real production deploy on a new domain sets
# OG_CORS_ORIGINS instead of needing a code change.
CORS_ORIGINS = [
    o.strip() for o in os.environ.get(
        'OG_CORS_ORIGINS', 'http://localhost:8080,https://genesis-eta-six.vercel.app'
    ).split(',') if o.strip()
]

# --- real telephony (Telnyx), optional — left unset until a real account
# exists. telephony.py checks these before every call instead of failing
# fast at import, so the app keeps booting (and every other feature keeps
# working) with no Telnyx account configured at all.
TELNYX_API_KEY = os.environ.get('TELNYX_API_KEY')
TELNYX_FROM_NUMBER = os.environ.get('TELNYX_FROM_NUMBER')
TELNYX_CONNECTION_ID = os.environ.get('TELNYX_CONNECTION_ID')
TELNYX_MESSAGING_PROFILE_ID = os.environ.get('TELNYX_MESSAGING_PROFILE_ID')
TELNYX_WHATSAPP_FROM = os.environ.get('TELNYX_WHATSAPP_FROM')
TELNYX_PUBLIC_KEY = os.environ.get('TELNYX_PUBLIC_KEY')

# --- real alert emails (SMTP), optional — same pattern as Telnyx above:
# alerts.py checks these before sending and never fails fast at import,
# so alert rules still fire and log to audit_log even with no SMTP
# account configured, just without the email step.
SMTP_HOST = os.environ.get('SMTP_HOST')
SMTP_PORT = int(os.environ.get('SMTP_PORT', '587'))
SMTP_USER = os.environ.get('SMTP_USER')
SMTP_PASSWORD = os.environ.get('SMTP_PASSWORD')
ALERT_EMAIL_FROM = os.environ.get('ALERT_EMAIL_FROM')
