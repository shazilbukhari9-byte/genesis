import psycopg2
import psycopg2.extras

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
    return psycopg2.connect(cursor_factory=psycopg2.extras.RealDictCursor, **DB_DSN)
