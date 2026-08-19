"""
Analytics (Section 12) — no warehouse, no ETL, no materialised view.
Every figure here is a live aggregate over interactions, so a rename or a
correction shows up immediately, and a drill-in never disagrees with the
summary it came from because both recompute from the same rows rather than
one trusting numbers handed to it by the other.

Where this stops scaling (kept from the doc, since it's still true here):
live aggregation is bounded by table size, not request rate. Today-scoped
queries stay fast because they hit started_at DESC; a rollup table written
on interaction close is the natural next step once this has to cover
millions of rows — not built here, since we don't have that volume.
"""

from datetime import datetime, timedelta, timezone
from flask import Blueprint, jsonify, request, g

from db import get_db

analytics_bp = Blueprint('analytics', __name__)


def _range():
    """Resolves ?from=/?to= with a seven-day default."""
    to = request.args.get('to')
    frm = request.args.get('from')
    to_dt = datetime.fromisoformat(to) if to else datetime.now(timezone.utc)
    from_dt = datetime.fromisoformat(frm) if frm else to_dt - timedelta(days=7)
    return from_dt, to_dt


def _filters(prefix=''):
    """Builds parameterised WHERE fragments from common query params."""
    clauses, params = [], []
    for key, col in (('queue_id', 'queue_id'), ('agent_id', 'agent_id'),
                      ('media', 'media'), ('result', 'result')):
        val = request.args.get(key)
        if val:
            clauses.append(f'{prefix}{col} = %s')
            params.append(val)
    return clauses, params


# ---------------------------------------------------------------------------
# /api/live/queues — one CTE per concern, left-joined onto queues so an
# idle queue still reports zeros instead of being missing entirely.
# ---------------------------------------------------------------------------

@analytics_bp.route('/api/live/queues')
def live_queues():
    """?division= scopes staff/talking counts to agents in that division
    (queues themselves aren't division-owned in this schema — only agents
    are). ?media= scopes every count to one media type."""
    tenant_id = g.tenant_id
    division = request.args.get('division')
    media = request.args.get('media')

    media_clause = 'AND media = %s' if media else ''
    div_join = 'JOIN users au ON au.id = i.agent_id' if division else ''
    div_clause = 'AND au.division = %s' if division else ''
    staff_div_clause = 'AND u.division = %s' if division else ''

    # Params in the exact order their %s placeholders appear below: today,
    # waiting, talking (tenant + optional media + optional division), staff
    # (optional division), and the final tenant filter.
    params = [tenant_id]
    if media:
        params.append(media)
    params.append(tenant_id)
    if media:
        params.append(media)
    params.append(tenant_id)
    if media:
        params.append(media)
    if division:
        params.append(division)
    if division:
        params.append(division)
    params.append(tenant_id)

    conn = get_db()
    cur = conn.cursor()
    cur.execute(
        f"""
        WITH today AS (
          SELECT queue_id, result, wait_s, answered_at
          FROM interactions
          WHERE tenant_id = %s AND started_at >= date_trunc('day', now()) {media_clause}
        ),
        waiting AS (
          SELECT queue_id, COUNT(*) AS n
          FROM interactions
          WHERE tenant_id = %s AND result = 'Active' AND answered_at IS NULL {media_clause}
          GROUP BY queue_id
        ),
        talking AS (
          SELECT i.queue_id, COUNT(*) AS n
          FROM interactions i
          {div_join}
          WHERE i.tenant_id = %s AND i.result = 'Active' AND i.answered_at IS NOT NULL {media_clause} {div_clause}
          GROUP BY i.queue_id
        ),
        staff AS (
          SELECT aq.queue_id, COUNT(*) AS n
          FROM agent_queues aq
          JOIN users u ON u.id = aq.agent_id
          WHERE u.on_queue = true {staff_div_clause}
          GROUP BY aq.queue_id
        ),
        today_agg AS (
          SELECT
            queue_id,
            COUNT(*) AS total_today,
            COUNT(*) FILTER (WHERE result = 'Abandoned') AS abandoned_today,
            COUNT(*) FILTER (WHERE result = 'Handled') AS handled_today,
            COUNT(*) FILTER (WHERE result IN ('Handled', 'Abandoned')) AS closed_today,
            COUNT(*) FILTER (WHERE answered_at IS NOT NULL) AS answered_today,
            COUNT(*) FILTER (WHERE answered_at IS NOT NULL AND wait_s <= q.service_level_threshold_s) AS within_sl
          FROM today
          JOIN queues q ON q.id = today.queue_id
          GROUP BY queue_id
        )
        SELECT
          q.id, q.name, q.max_wait_s, q.service_level_threshold_s,
          COALESCE(today_agg.total_today, 0) AS today,
          COALESCE(waiting.n, 0) AS waiting,
          COALESCE(talking.n, 0) AS talking,
          COALESCE(staff.n, 0) AS staff,
          COALESCE(today_agg.handled_today, 0) AS handled_today,
          ROUND(100.0 * COALESCE(today_agg.within_sl, 0) / NULLIF(today_agg.answered_today, 0), 1) AS service_level,
          ROUND(100.0 * COALESCE(today_agg.abandoned_today, 0) / NULLIF(today_agg.closed_today, 0), 1) AS abandon_rate
        FROM queues q
        LEFT JOIN today_agg ON today_agg.queue_id = q.id
        LEFT JOIN waiting ON waiting.queue_id = q.id
        LEFT JOIN talking ON talking.queue_id = q.id
        LEFT JOIN staff ON staff.queue_id = q.id
        WHERE q.tenant_id = %s
        ORDER BY q.name
        """,
        params,
    )
    rows = cur.fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])


# ---------------------------------------------------------------------------
# /api/live/agents — per-agent presence, active count, handled today,
# AHT today, queue membership.
# ---------------------------------------------------------------------------

@analytics_bp.route('/api/live/agents')
def live_agents():
    division = request.args.get('division')
    media = request.args.get('media')
    media_clause = 'AND media = %s' if media else ''
    div_clause = 'AND u.division = %s' if division else ''

    # Order matches the %s placeholders below: active (media), handled (media),
    # then the final tenant + division filter.
    params = ([media] if media else []) + ([media] if media else []) + [g.tenant_id] + ([division] if division else [])

    conn = get_db()
    cur = conn.cursor()
    cur.execute(
        f"""
        SELECT
          u.id, u.name, u.presence, u.on_queue, u.routing_status, u.division,
          COALESCE(active.n, 0) AS active_count,
          COALESCE(handled.n, 0) AS handled_today,
          handled.aht_today,
          COALESCE(memberships.queue_names, ARRAY[]::text[]) AS queues
        FROM users u
        LEFT JOIN (
          SELECT agent_id, COUNT(*) AS n
          FROM interactions WHERE result = 'Active' AND agent_id IS NOT NULL {media_clause}
          GROUP BY agent_id
        ) active ON active.agent_id = u.id
        LEFT JOIN (
          SELECT agent_id,
            COUNT(*) AS n,
            ROUND(AVG(COALESCE(talk_s, 0) + COALESCE(acw_s, 0))) AS aht_today
          FROM interactions
          WHERE result = 'Handled' AND started_at >= date_trunc('day', now()) AND agent_id IS NOT NULL {media_clause}
          GROUP BY agent_id
        ) handled ON handled.agent_id = u.id
        LEFT JOIN (
          SELECT aq.agent_id, array_agg(q.name ORDER BY q.name) AS queue_names
          FROM agent_queues aq JOIN queues q ON q.id = aq.queue_id
          GROUP BY aq.agent_id
        ) memberships ON memberships.agent_id = u.id
        WHERE u.tenant_id = %s {div_clause}
        ORDER BY u.name
        """,
        params,
    )
    rows = cur.fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])


# ---------------------------------------------------------------------------
# /api/live/flows — per-flow entry/abandon counts, joined to interactions
# by the flow_id set at call-routing time. ?division= scopes to interactions
# answered by an agent in that division; ?media= scopes to one media type.
# ---------------------------------------------------------------------------

@analytics_bp.route('/api/live/flows')
def live_flows():
    tenant_id = g.tenant_id
    division = request.args.get('division')
    media = request.args.get('media')

    div_join = 'LEFT JOIN users au ON au.id = i.agent_id' if division else ''
    div_clause = 'AND (au.division = %s OR i.agent_id IS NULL)' if division else ''
    media_clause = 'AND i.media = %s' if media else ''

    conn = get_db()
    cur = conn.cursor()
    cur.execute(
        f"""
        SELECT
          f.id, f.name,
          COUNT(i.id) AS entries,
          COUNT(*) FILTER (WHERE i.result = 'Abandoned') AS abandoned,
          COUNT(*) FILTER (WHERE i.result = 'Handled') AS completed
        FROM flows f
        LEFT JOIN interactions i ON i.flow_id = f.id {media_clause}
        {div_join}
        WHERE f.tenant_id = %s {div_clause}
        GROUP BY f.id, f.name
        ORDER BY f.name
        """,
        # media (if any) binds inside the LEFT JOIN clause, tenant_id then division
        ([media] if media else []) + [tenant_id] + ([division] if division else []),
    )
    rows = cur.fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])


# ---------------------------------------------------------------------------
# /api/live/summary — ten scalar subqueries in one round trip.
# ---------------------------------------------------------------------------

@analytics_bp.route('/api/live/summary')
def live_summary():
    tenant_id = g.tenant_id

    conn = get_db()
    cur = conn.cursor()
    cur.execute(
        """
        SELECT
          (SELECT COUNT(*) FROM interactions WHERE tenant_id = %s AND started_at >= date_trunc('day', now())) AS total_today,
          (SELECT COUNT(*) FROM interactions WHERE tenant_id = %s AND result = 'Active' AND answered_at IS NULL) AS waiting_now,
          (SELECT COUNT(*) FROM interactions WHERE tenant_id = %s AND result = 'Active' AND answered_at IS NOT NULL) AS talking_now,
          (SELECT COUNT(*) FROM interactions WHERE tenant_id = %s AND result = 'Abandoned' AND started_at >= date_trunc('day', now())) AS abandoned_today,
          (SELECT COUNT(*) FROM interactions WHERE tenant_id = %s AND result = 'Handled' AND started_at >= date_trunc('day', now())) AS handled_today,
          (SELECT ROUND(AVG(wait_s)) FROM interactions WHERE tenant_id = %s AND answered_at IS NOT NULL AND started_at >= date_trunc('day', now())) AS avg_wait_s_today,
          (SELECT ROUND(AVG(talk_s)) FROM interactions WHERE tenant_id = %s AND talk_s IS NOT NULL AND started_at >= date_trunc('day', now())) AS avg_talk_s_today,
          (SELECT COUNT(*) FROM users WHERE tenant_id = %s AND presence != 'Offline') AS agents_online,
          (SELECT COUNT(*) FROM users WHERE tenant_id = %s AND routing_status = 'Idle') AS agents_available,
          (SELECT ROUND(100.0 *
             COUNT(*) FILTER (WHERE i.answered_at IS NOT NULL AND i.wait_s <= q.service_level_threshold_s)
             / NULLIF(COUNT(*) FILTER (WHERE i.answered_at IS NOT NULL), 0), 1)
             FROM interactions i JOIN queues q ON q.id = i.queue_id
             WHERE i.tenant_id = %s AND i.started_at >= date_trunc('day', now())) AS service_level_today
        """,
        (tenant_id,) * 10,
    )
    row = cur.fetchone()
    conn.close()
    return jsonify(dict(row))


# ---------------------------------------------------------------------------
# /api/reports/<key> — a fixed catalog; an unknown key is a 404, not a
# query. Scoped to a handful of reports rather than the doc's 20, since
# we don't know what the other 14 were — same dispatch mechanism, smaller
# catalog.
# ---------------------------------------------------------------------------

def _report_queue_summary(tenant_id, from_dt, to_dt):
    conn = get_db()
    cur = conn.cursor()
    # Grouped by interactions.queue_name (not a queues-table join) — queue_name
    # is populated on every interaction regardless of whether a matching row
    # exists in queues, so this reports real per-queue totals even for
    # tenants whose queues table isn't (yet) fully seeded.
    cur.execute(
        """
        SELECT queue_name AS queue,
          COUNT(*) AS total,
          COUNT(*) FILTER (WHERE result = 'Handled') AS handled,
          COUNT(*) FILTER (WHERE result = 'Abandoned') AS abandoned,
          ROUND(AVG(wait_s)) AS avg_wait_s
        FROM interactions
        WHERE tenant_id = %s AND started_at BETWEEN %s AND %s AND queue_name IS NOT NULL
        GROUP BY queue_name ORDER BY queue_name
        """,
        (tenant_id, from_dt, to_dt),
    )
    rows = cur.fetchall()
    conn.close()
    return rows


def _report_agent_summary(tenant_id, from_dt, to_dt):
    conn = get_db()
    cur = conn.cursor()
    cur.execute(
        """
        SELECT u.name AS agent,
          COUNT(i.id) FILTER (WHERE i.result = 'Handled') AS handled,
          ROUND(AVG(COALESCE(i.talk_s,0) + COALESCE(i.acw_s,0)) FILTER (WHERE i.result = 'Handled')) AS aht
        FROM users u
        LEFT JOIN interactions i ON i.agent_id = u.id AND i.started_at BETWEEN %s AND %s
        WHERE u.tenant_id = %s
        GROUP BY u.name ORDER BY u.name
        """,
        (from_dt, to_dt, tenant_id),
    )
    rows = cur.fetchall()
    conn.close()
    return rows


def _report_abandoned_calls(tenant_id, from_dt, to_dt):
    conn = get_db()
    cur = conn.cursor()
    cur.execute(
        """
        SELECT id, customer_name, queue_name, wait_s, started_at
        FROM interactions
        WHERE tenant_id = %s AND result = 'Abandoned' AND started_at BETWEEN %s AND %s
        ORDER BY started_at DESC
        """,
        (tenant_id, from_dt, to_dt),
    )
    rows = cur.fetchall()
    conn.close()
    return rows


def _report_media_breakdown(tenant_id, from_dt, to_dt):
    conn = get_db()
    cur = conn.cursor()
    cur.execute(
        """
        SELECT media, COUNT(*) AS total
        FROM interactions
        WHERE tenant_id = %s AND started_at BETWEEN %s AND %s
        GROUP BY media ORDER BY media
        """,
        (tenant_id, from_dt, to_dt),
    )
    rows = cur.fetchall()
    conn.close()
    return rows


def _report_daily_volume(tenant_id, from_dt, to_dt):
    conn = get_db()
    cur = conn.cursor()
    cur.execute(
        """
        SELECT date_trunc('day', started_at)::date AS day, COUNT(*) AS total
        FROM interactions
        WHERE tenant_id = %s AND started_at BETWEEN %s AND %s
        GROUP BY day ORDER BY day
        """,
        (tenant_id, from_dt, to_dt),
    )
    rows = cur.fetchall()
    conn.close()
    return rows


CATALOG = {
    'queue-summary': _report_queue_summary,
    'agent-summary': _report_agent_summary,
    'abandoned-calls': _report_abandoned_calls,
    'media-breakdown': _report_media_breakdown,
    'daily-volume': _report_daily_volume,
}


@analytics_bp.route('/api/reports/<key>')
def run_report(key):
    fn = CATALOG.get(key)
    if fn is None:
        return jsonify({'ok': False, 'error': 'unknown report key'}), 404

    from_dt, to_dt = _range()
    rows = fn(g.tenant_id, from_dt, to_dt)
    data = [dict(r) for r in rows]
    columns = list(data[0].keys()) if data else []

    return jsonify({
        'report': key,
        'from': from_dt.isoformat(),
        'to': to_dt.isoformat(),
        'columns': columns,
        'data': data,
        'row_count': len(data),
    })
