"""
Operations: recording retention (Section 15). What own-genesys-retention.timer
would run nightly on a real box: delete each expired recording at the
carrier first, and only clear the local pointer once that succeeds — a local
row shouldn't say "gone" while the file still sits in Twilio.

There's no Twilio account in this dev environment, so _delete_at_carrier is a
stub that always succeeds. It exists as its own function, called before the
local clear, so the real implementation is a one-function swap and the
carrier-first ordering doesn't have to be rebuilt later.
"""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from db import get_db

DEFAULT_RETENTION_DAYS = 90


def _delete_at_carrier(recording_url):
    """No Twilio account here — nothing to call. A real deployment would
    DELETE the recording via the Twilio API before it's safe to drop the
    local pointer."""
    return True


def run_retention(retention_days=DEFAULT_RETENTION_DAYS):
    conn = get_db()
    cur = conn.cursor()
    cur.execute(
        """
        SELECT id, recording_url FROM interactions
        WHERE recording_url IS NOT NULL
          AND ended_at IS NOT NULL
          AND ended_at < now() - (%s || ' days')::interval
        """,
        (retention_days,),
    )
    rows = cur.fetchall()

    cleared = []
    for row in rows:
        if _delete_at_carrier(row['recording_url']):
            cur.execute('UPDATE interactions SET recording_url = NULL WHERE id = %s', (row['id'],))
            cleared.append(row['id'])

    conn.commit()
    conn.close()
    return cleared


if __name__ == '__main__':
    cleared = run_retention()
    print(f'cleared {len(cleared)} recording(s) older than {DEFAULT_RETENTION_DAYS}d')
    sys.exit(0)
