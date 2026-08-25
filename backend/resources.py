"""
Resource registry — declarative CRUD for plain admin-entity tables.

Instead of writing a near-identical set of routes per entity, each entity is
declared here as data, and 5 generic handlers in app.py (registered via
register_resource_routes) serve all of them: list, get, create, update, delete.

Adapted from the "Own Genesys backend" reference doc (Section 8) for SQLite:
no jsonb/uuid[] coercion (SQLite has no native array/json column types) and
LIKE instead of ILIKE (SQLite's LIKE is already case-insensitive for ASCII).

`perm` is still unused: auth.py (Section 13) added a bearer-token guard that
requires *some* valid session on every /api/* route, but users have no role
or clearance field to check `perm` against — only tenant_id and presence.
Every one of these 5 resources is currently equally writable by any signed-in
user. That's the real remaining gap; enforcing `perm` needs a role column on
users first, so it isn't faked here with a permission model that doesn't
back onto real data.
"""

REGISTRY = {
    # People & Permissions' People page (frontend/src/features/people-permissions) —
    # reuses the real `users` table rather than a separate one.
    "people": dict(
        table="users",
        order="name",
        fields=[
            "tenant_id", "name", "email", "license_code", "state", "division", "title", "dept", "station", "ext",
            "roles", "skills", "langs", "lang_proficiency",
        ],
        search=["name", "email"],
        perm=None,
    ),
    # divisions is NOT here — its primary key is a text `code`, not an
    # integer id, so it can't use these <int:row_id> routes. See app.py's
    # dedicated /api/divisions routes instead.
    # ACD Skills and ACD Languages are the same table (simple_entities),
    # filtered by ?kind=skill or ?kind=lang — kind is in `fields` so the
    # generic list handler already supports that query param filter.
    "simple-entities": dict(
        table="simple_entities",
        order="name",
        fields=["tenant_id", "kind", "name", "description"],
        search=["name"],
        perm=None,
    ),
    # Roles and Groups (People & Permissions) — both have an integer id,
    # so unlike divisions they fit the generic <int:row_id> routes directly.
    "roles": dict(
        table="roles",
        order="name",
        fields=["tenant_id", "name", "description", "base", "perms"],
        search=["name"],
        perm=None,
    ),
    "groups": dict(
        table="people_groups",
        order="name",
        fields=["tenant_id", "name", "type", "ext", "ring", "members", "vm"],
        search=["name"],
        perm=None,
    ),
    "purchases": dict(
        table="purchases",
        order="purchased_at DESC, id DESC",
        fields=["item", "category", "price", "purchased_at"],
        search=["item", "category"],
        perm=None,
    ),
    # tenant_id stays listed in `fields` so app.py can tell "this table is
    # tenant-scoped" — but app.py never lets a client set or filter it
    # directly: create forces it from g.tenant_id, list/get/update/delete all
    # scope by it automatically. See _tenant_scoped() in app.py.
    # plans/routes aren't exposed here — the Sites create/edit form never
    # sets them directly (they're auto-defaulted on create and managed via
    # the separate Number Plans / Outbound Routes admin pages, which this
    # entity doesn't cover yet); leaving them out avoids sending a Python
    # list through the generic JSONB path, which psycopg2 doesn't adapt to
    # JSON array syntax by default (see the DEFAULT '[]' on the column).
    "sites": dict(
        table="sites",
        order="name",
        fields=["tenant_id", "name", "location", "tz", "media", "is_default", "edge_group"],
        search=["name"],
        perm=None,
    ),
    "wrapup-codes": dict(
        table="wrapup_codes",
        order="name",
        fields=["tenant_id", "name", "description"],
        search=["name"],
        perm=None,
    ),
    "surveys": dict(
        table="surveys",
        order="created_at DESC",
        fields=["tenant_id", "customer_name", "agent_name", "queue_name", "score", "nps", "comment"],
        search=["customer_name", "agent_name"],
        perm=None,
    ),
    "callbacks": dict(
        table="callbacks",
        order="requested_at DESC",
        fields=["tenant_id", "customer_name", "ani", "queue_name", "requested_at",
                 "due_at", "origin", "state", "agent_id", "notes"],
        search=["customer_name", "ani"],
        perm=None,
    ),
    "voicemails": dict(
        table="voicemails",
        order="left_at DESC",
        fields=["tenant_id", "from_name", "ani", "queue_name", "left_at",
                 "duration_s", "transcript", "state"],
        search=["from_name"],
        perm=None,
    ),
    "trunks": dict(
        table="trunks",
        order="priority, name",
        fields=["tenant_id", "name", "priority", "enabled", "is_platform",
                 "type", "transport", "servers", "codecs", "caller_id", "edge_group", "state"],
        search=["name"],
        perm=None,
    ),
    "flows": dict(
        table="flows",
        order="name",
        fields=["tenant_id", "name", "graph"],
        search=["name"],
        perm=None,
    ),
    # matches the reference doc's own Section 8 example almost verbatim
    "call-routes": dict(
        table="call_routes",
        order="priority, name",
        fields=["tenant_id", "name", "match_type", "pattern", "destination_type",
                 "flow_id", "queue_id", "user_id", "external_number", "priority",
                 "enabled", "description"],
        search=["name", "pattern", "description"],
        perm=None,
    ),
    "did-assignments": dict(
        table="did_assignments",
        order="phone_number",
        fields=["tenant_id", "phone_number", "destination_type", "flow_id", "queue_id",
                 "assignment_type", "target_label"],
        search=["phone_number"],
        perm=None,
    ),
    "extension-pools": dict(
        table="extension_pools",
        order="start_ext",
        fields=["tenant_id", "start_ext", "end_ext"],
        search=["start_ext", "end_ext"],
        perm=None,
    ),
    "edges": dict(
        table="edges",
        order="name",
        fields=["tenant_id", "name", "model", "edge_group", "state"],
        search=["name"],
        perm=None,
    ),
    "emergency-groups": dict(
        table="emergency_groups",
        order="name",
        fields=["tenant_id", "name", "flows", "active"],
        search=["name"],
        perm=None,
    ),
    "email-domains": dict(
        table="email_domains",
        order="domain",
        fields=["tenant_id", "domain", "verified"],
        search=["domain"],
        perm=None,
    ),
    "email-addresses": dict(
        table="email_addresses",
        order="addr",
        fields=["tenant_id", "addr", "route", "target"],
        search=["addr"],
        perm=None,
    ),
    "eval-forms": dict(
        table="eval_forms",
        order="name",
        fields=["tenant_id", "name", "published", "groups"],
        search=["name"],
        perm=None,
        # groups is JSONB storing a *list* at its top level — psycopg2 only
        # auto-adapts dict -> jsonb (see db.py), so a bare Python list needs
        # explicit Json() wrapping (see app.py's _prep_value) or it adapts
        # as a Postgres ARRAY literal instead and round-trips wrong.
        json_fields=["groups"],
    ),
    # ── Evaluations (Quality & WEM > Evaluation Forms > Perform Evaluation) ──
    "evals": dict(
        table="evals",
        order="created_at DESC",
        fields=[
            "tenant_id", "form_id", "interaction_id", "agent_id", "evaluator_id",
            "answers", "pct", "critical_fail",
        ],
        search=[],
        perm=None,
        # answers is JSONB storing a *dict* (question id -> answer), not a
        # list, so it round-trips fine through db.py's plain dict->jsonb
        # adapter — no json_fields entry needed here (contrast eval_forms.groups
        # above, which stores a list and does need the opt-out).
    ),
    # ── Prompts (Routing > Prompts) ──
    "prompts": dict(
        table="prompts",
        order="name",
        fields=["tenant_id", "name", "description", "tts", "lang", "audio_name"],
        search=["name", "description"],
        perm=None,
    ),
    # ── Phone Base Settings (Telephony > Phone Base Settings) ──
    "base-settings": dict(
        table="base_settings",
        order="name",
        fields=["tenant_id", "name", "model", "codec", "rtp_port"],
        search=["name", "model"],
        perm=None,
    ),
    # ── Phone Management (Telephony > Phone Management) ──
    "phones": dict(
        table="phones",
        order="name",
        fields=["tenant_id", "name", "base_name", "site_name", "assigned_user", "mac", "status"],
        search=["name", "mac"],
        perm=None,
    ),
    # ── Number Plans (Telephony > Number Plans, scoped to site_name) ──
    "number-plans": dict(
        table="number_plans",
        order="sort_order, name",
        fields=["tenant_id", "site_name", "name", "match_type", "match_spec",
                 "classification", "normalisation", "sort_order"],
        search=["name"],
        perm=None,
    ),
    # ── Outbound Routes (Telephony > Outbound Routes, scoped to site_name) ──
    "outbound-routes": dict(
        table="outbound_routes",
        order="name",
        fields=["tenant_id", "site_name", "name", "classifications", "trunk_ids",
                 "distribution", "enabled"],
        search=["name"],
        perm=None,
    ),
    # ── Message Channels (Contact Center > Message Routing) ──
    "message-channels": dict(
        table="message_channels",
        order="channel_type, name",
        fields=["tenant_id", "channel_type", "name", "config", "queue_id", "enabled"],
        search=["name", "channel_type"],
        perm=None,
    ),
    "queues": dict(
        table="queues",
        order="name",
        fields=["tenant_id", "name", "max_wait_s", "division", "config"],
        search=["name"],
        perm=None,
    ),
    "recording-policies": dict(
        table="recording_policies",
        order="name",
        fields=["tenant_id", "name", "media", "queues", "retention", "pct", "active"],
        search=["name"],
        perm=None,
    ),
    "schedule-groups": dict(
        table="schedule_groups",
        order="name",
        fields=["tenant_id", "name", "open_hours", "holidays", "state"],
        search=["name"],
        perm=None,
    ),
    "scripts": dict(
        table="scripts",
        order="name",
        fields=["tenant_id", "name", "type", "published"],
        search=["name"],
        perm=None,
    ),
    "phone-base-settings": dict(
        table="phone_base_settings",
        order="name",
        fields=["tenant_id", "name", "model", "codec", "port"],
        search=["name"],
        perm=None,
    ),
    "byoc-trunks": dict(
        table="byoc_trunks",
        order="priority, name",
        fields=["tenant_id", "name", "priority", "status", "locked", "config"],
        search=["name"],
        perm=None,
    ),
    "campaigns": dict(
        table="campaigns",
        order="name",
        fields=["tenant_id", "name", "division", "mode", "queue_ref", "script_ref",
                 "list_ref", "dnc_ref", "caller_id", "caller_name", "pace",
                 "max_attempts", "status"],
        search=["name"],
        perm=None,
    ),
    "planning-groups": dict(
        table="planning_groups",
        order="name",
        fields=["tenant_id", "name", "queues", "skills", "langs"],
        search=["name"],
        perm=None,
    ),
    "service-goals": dict(
        table="service_goals",
        order="name",
        fields=["tenant_id", "name", "sl", "sls", "asa", "abn", "pgs"],
        search=["name"],
        perm=None,
    ),
    "forecasts": dict(
        table="forecasts",
        order="week DESC",
        fields=["tenant_id", "week", "status", "data"],
        search=["week"],
        perm=None,
    ),
    "gamification-profiles": dict(
        table="gamification_profiles",
        order="name",
        fields=["tenant_id", "name", "applies_to", "target", "m1", "t1", "w1", "m2", "t2", "w2",
                 "leaderboard", "badges", "challenges", "reset_period", "status"],
        search=["name"],
        perm=None,
    ),
    "installed-integrations": dict(
        table="installed_integrations",
        order="name",
        fields=["tenant_id", "name", "category", "type", "credentials", "used_by", "division", "status"],
        search=["name", "category", "type"],
        perm=None,
    ),
    "integration-credentials": dict(
        table="integration_credentials",
        order="name",
        fields=["tenant_id", "name", "integration_name", "rotated_at"],
        search=["name", "integration_name"],
        perm=None,
    ),
    "work-plans": dict(
        table="work_plans",
        order="name",
        fields=["tenant_id", "name", "days", "shift_len", "flex_from", "flex_to", "paid", "agents"],
        search=["name"],
        perm=None,
    ),
    "activity-codes": dict(
        table="activity_codes",
        order="name",
        fields=["tenant_id", "name", "category", "paid", "adherence", "adherence_rule", "enabled"],
        search=["name"],
        perm=None,
    ),
    "time-off-requests": dict(
        table="time_off_requests",
        order="id DESC",
        fields=["tenant_id", "agent_ref", "code", "dates", "day", "status"],
        search=["code"],
        perm=None,
    ),
    "shift-trades": dict(
        table="shift_trades",
        order="id DESC",
        fields=["tenant_id", "from_ref", "to_ref", "day", "status"],
        search=[],
        perm=None,
    ),
    "wfm-schedules": dict(
        table="wfm_schedules",
        order="week DESC",
        fields=["tenant_id", "week", "status", "data", "entries"],
        search=["week"],
        perm=None,
    ),
    "calibrations": dict(
        table="calibrations",
        order="name",
        fields=[
            "tenant_id", "name", "form_ref", "interaction_ref", "division", "status", "evaluators", "notes",
            "due_date", "hide_scores_until_complete", "include_agent_self_assessment", "notify_evaluators_by_email",
        ],
        search=["name"],
        perm=None,
        # evaluators is JSONB storing a *list* — see eval-forms' json_fields note.
        json_fields=["evaluators"],
    ),
    "bot-connectors": dict(
        table="bot_connectors",
        order="name",
        fields=["tenant_id", "name", "platform", "status", "webhook_url", "notes"],
        search=["name"],
        perm=None,
    ),
}
