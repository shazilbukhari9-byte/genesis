"""
Operations: nightly backup (Section 15). On a real Linux box this is what
own-genesys-backup.service + .timer would run; here it's a plain script you
can run by hand or point Windows Task Scheduler at.

pg_dump's plain-text output is piped straight into a .gz file so no
uncompressed dump ever touches disk. Written to a .partial name first and
only renamed to the final .sql.gz once the archive is verified — a dump that
dies partway through never gets mistaken for a good backup. Verification
checks the gzip stream decompresses cleanly and that the dump contains at
least MIN_COPY_STATEMENTS `COPY` lines (a near-empty dump is almost always a
symptom of a bad DSN or an early pg_dump failure, not a genuinely empty DB).
Backups older than RETENTION_DAYS are pruned after a successful run.
"""

import gzip
import os
import subprocess
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
import config

DATABASE_DIR = os.path.join(os.path.dirname(__file__), '..', '..', 'database')
BACKUP_DIR = os.path.join(DATABASE_DIR, 'backups')
PG_DUMP = os.path.join(DATABASE_DIR, 'pg', 'pgsql', 'bin', 'pg_dump.exe')
# schema.sql currently defines 22 tables -> 22 COPY statements in a full dump;
# floor is set a bit below that so it still catches a dump that died early
MIN_COPY_STATEMENTS = 18
RETENTION_DAYS = 14


def _dump_env():
    env = os.environ.copy()
    env['PGPASSWORD'] = config.DB_PASSWORD
    return env


def run_backup():
    os.makedirs(BACKUP_DIR, exist_ok=True)
    stamp = time.strftime('%Y%m%d-%H%M%S', time.gmtime())
    final_path = os.path.join(BACKUP_DIR, f'{stamp}.sql.gz')
    partial_path = final_path + '.partial'

    proc = subprocess.Popen(
        [PG_DUMP, '-h', config.DB_HOST, '-p', str(config.DB_PORT),
         '-U', config.DB_USER, '-d', config.DB_NAME, '--no-owner'],
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=_dump_env(),
    )

    with gzip.open(partial_path, 'wb') as gz:
        for chunk in iter(lambda: proc.stdout.read(65536), b''):
            gz.write(chunk)
    _, stderr = proc.communicate()

    if proc.returncode != 0:
        os.remove(partial_path)
        raise RuntimeError(f'pg_dump failed (exit {proc.returncode}): {stderr.decode(errors="replace")}')

    copy_count = _verify(partial_path)
    if copy_count < MIN_COPY_STATEMENTS:
        os.remove(partial_path)
        raise RuntimeError(f'backup verification failed: only {copy_count} COPY statements, expected >= {MIN_COPY_STATEMENTS}')

    os.replace(partial_path, final_path)
    pruned = _prune()
    return {'path': final_path, 'copy_statements': copy_count, 'pruned': pruned}


def _verify(gz_path):
    """Decompress and count COPY statements — raises on a corrupt gzip stream."""
    count = 0
    with gzip.open(gz_path, 'rt', encoding='utf-8', errors='replace') as f:
        for line in f:
            if line.startswith('COPY '):
                count += 1
    return count


def _prune():
    cutoff = time.time() - RETENTION_DAYS * 86400
    removed = []
    for name in os.listdir(BACKUP_DIR):
        if not name.endswith('.sql.gz'):
            continue
        path = os.path.join(BACKUP_DIR, name)
        if os.path.getmtime(path) < cutoff:
            os.remove(path)
            removed.append(name)
    return removed


if __name__ == '__main__':
    result = run_backup()
    print(f"backup ok: {result['path']} ({result['copy_statements']} COPY statements)")
    if result['pruned']:
        print(f"pruned {len(result['pruned'])} backup(s) older than {RETENTION_DAYS}d: {result['pruned']}")
    sys.exit(0)
