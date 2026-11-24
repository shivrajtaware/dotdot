#!/bin/sh
set -u

umask 077

case "${BACKUP_INTERVAL_SECONDS:-21600}" in ''|*[!0-9]*) echo "BACKUP_INTERVAL_SECONDS must be numeric." >&2; exit 1 ;; esac
case "${BACKUP_RETENTION_DAYS:-14}" in ''|*[!0-9]*) echo "BACKUP_RETENTION_DAYS must be numeric." >&2; exit 1 ;; esac
[ "${BACKUP_INTERVAL_SECONDS:-21600}" -ge 3600 ] || { echo "BACKUP_INTERVAL_SECONDS must be at least 3600." >&2; exit 1; }
[ "${BACKUP_RETENTION_DAYS:-14}" -ge 7 ] && [ "${BACKUP_RETENTION_DAYS:-14}" -le 365 ] || { echo "BACKUP_RETENTION_DAYS must be between 7 and 365." >&2; exit 1; }

backup_once() {
  if ! printf '%s' "${POSTGRES_DB:-}" | grep -Eq '^[A-Za-z0-9_]+$' || \
     ! printf '%s' "${POSTGRES_USER:-}" | grep -Eq '^[A-Za-z0-9_]+$' || \
     [ -z "${POSTGRES_PASSWORD:-}" ]; then
    echo "[$(date -u +%FT%TZ)] Backup skipped: database connection settings are invalid." >&2
    return 1
  fi

  export PGPASSWORD="$POSTGRES_PASSWORD"
  stamp=$(date -u +%Y%m%dT%H%M%SZ)
  final="/backups/krushinath-${stamp}.dump"
  temporary=$(mktemp /backups/.krushinath-pending.XXXXXX) || return 1

  echo "[$(date -u +%FT%TZ)] Starting PostgreSQL backup."
  if ! pg_dump --host=db --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" --format=custom --no-owner --no-privileges --file="$temporary"; then
    rm -f "$temporary"
    echo "[$(date -u +%FT%TZ)] Backup failed while dumping the database." >&2
    return 1
  fi

  if ! pg_restore --list "$temporary" >/dev/null; then
    rm -f "$temporary"
    echo "[$(date -u +%FT%TZ)] Backup failed validation; incomplete archive was discarded." >&2
    return 1
  fi

  chmod 600 "$temporary" && mv "$temporary" "$final" || {
    rm -f "$temporary"
    echo "[$(date -u +%FT%TZ)] Backup failed while publishing the validated archive." >&2
    return 1
  }

  touch /backups/.last-success
  find /backups -maxdepth 1 -type f -name 'krushinath-*.dump' -mtime "+${BACKUP_RETENTION_DAYS:-14}" -delete
  echo "[$(date -u +%FT%TZ)] Backup complete: $(basename "$final")."
  return 0
}

if [ "${1:-}" = "healthcheck" ]; then
  [ -f /backups/.last-success ] || exit 1
  now=$(date +%s)
  last=$(stat -c %Y /backups/.last-success) || exit 1
  [ "$((now - last))" -le "$(( ${BACKUP_INTERVAL_SECONDS:-21600} + 1800 ))" ]
  exit $?
fi

if [ "${1:-}" = "once" ]; then
  backup_once
  exit $?
fi

while :; do
  if backup_once; then
    sleep "${BACKUP_INTERVAL_SECONDS:-21600}"
  else
    sleep 900
  fi
done
