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
    "trunks": dict(
        table="trunks",
        order="priority, name",
        fields=["tenant_id", "name", "priority", "enabled", "is_platform"],
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
        fields=["tenant_id", "phone_number", "destination_type", "flow_id", "queue_id"],
        search=["phone_number"],
        perm=None,
    ),
}
