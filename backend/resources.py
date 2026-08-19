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
        fields=["tenant_id", "name", "email", "license_code", "state", "division", "title", "dept", "station", "ext"],
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
}
