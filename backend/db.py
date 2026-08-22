import psycopg2
import psycopg2.extras
from flask import g, has_app_context

import config

# dicts written through any query (including the generic resource registry's
# jsonb columns, e.g. flows.graph) get adapted to jsonb automatically
psycopg2.extensions.register_adapter(dict, psycopg2.extras.Json)

DB_DSN = dict(
    host=config.DB_HOST,
    port=config.DB_PORT,
    dbname=config.DB_NAME,
    user=config.DB_USER,
    password=config.DB_PASSWORD,
)


def get_db():
    """Open a connection, registering it for guaranteed teardown.

    Routes follow a `conn = get_db() ... conn.commit(); conn.close()` pattern
    with no try/finally, so any exception between those two calls used to skip
    close() entirely and leak the connection until CPython's refcounting got
    around to it. Under a burst of failing writes that can exhaust
    max_connections. Every connection handed out inside a request context is
    now tracked on `g` and closed by close_request_connections() in the
    app-context teardown, whether or not the route reached its own close().
    """
    conn = psycopg2.connect(cursor_factory=psycopg2.extras.RealDictCursor, **DB_DSN)
    if has_app_context():
        g.setdefault('_open_conns', []).append(conn)
    return conn


def close_request_connections(_exc=None):
    """Roll back and close any connection the request did not close itself.

    Registered as a teardown_appcontext handler in app.py. A connection the
    route already closed is skipped, so the normal path is unaffected; an
    unclosed one is rolled back first so a half-finished transaction is never
    left holding locks.
    """
    for conn in g.pop('_open_conns', []):
        if conn.closed:
            continue
        try:
            conn.rollback()
        except Exception:
            pass
        try:
            conn.close()
        except Exception:
            pass
