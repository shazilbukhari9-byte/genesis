"""
Operations: health check (Section 15). What own-genesys-healthcheck.timer
would run every few minutes on a real box. Probes the app the same way an
external monitor would (HTTP, not an in-process import) plus a few things
only visible from the host: disk space and backup freshness.

TLS expiry and restart-count checks are noted as not-applicable rather than
faked — this dev box serves plain HTTP and isn't running under a supervisor
that tracks restarts, so a made-up number would be worse than admitting the
check doesn't apply here.
"""

import json
import os
import shutil
import sys
import time
import urllib.request

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
import config

BACKUP_DIR = os.path.join(os.path.dirname(__file__), '..', '..', 'database', 'backups')
BACKUP_MAX_AGE_HOURS = 26  # nightly backup + slack
DISK_WARN_PCT = 90


def check_api():
    url = f'http://{config.HOST}:{config.PORT}/api/health'
    try:
        with urllib.request.urlopen(url, timeout=5) as resp:
            body = json.loads(resp.read())
            return {'ok': resp.status == 200 and body.get('status') == 'ok', 'detail': body}
    except Exception as exc:
        return {'ok': False, 'detail': str(exc)}


def check_disk():
    total, used, free = shutil.disk_usage(os.path.dirname(__file__))
    pct_used = used / total * 100
    return {'ok': pct_used < DISK_WARN_PCT, 'detail': f'{pct_used:.1f}% used, {free // (1024**3)}GB free'}


def check_backup_freshness():
    if not os.path.isdir(BACKUP_DIR):
        return {'ok': False, 'detail': 'no backup directory yet'}
    backups = [f for f in os.listdir(BACKUP_DIR) if f.endswith('.sql.gz')]
    if not backups:
        return {'ok': False, 'detail': 'no backups found'}
    newest = max(os.path.getmtime(os.path.join(BACKUP_DIR, f)) for f in backups)
    age_hours = (time.time() - newest) / 3600
    return {'ok': age_hours < BACKUP_MAX_AGE_HOURS, 'detail': f'newest backup is {age_hours:.1f}h old'}


def run_health_check():
    checks = {
        'api': check_api(),
        'disk': check_disk(),
        'backup_freshness': check_backup_freshness(),
        'tls_expiry': {'ok': None, 'detail': 'not applicable — dev server has no TLS'},
        'restart_count': {'ok': None, 'detail': 'not applicable — no process supervisor on this dev box'},
    }
    healthy = all(c['ok'] is not False for c in checks.values())
    return {'healthy': healthy, 'checks': checks}


if __name__ == '__main__':
    result = run_health_check()
    for name, c in result['checks'].items():
        status = 'SKIP' if c['ok'] is None else ('OK' if c['ok'] else 'FAIL')
        print(f'[{status}] {name}: {c["detail"]}')
    sys.exit(0 if result['healthy'] else 1)
