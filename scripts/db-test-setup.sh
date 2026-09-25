#!/usr/bin/env bash
# Creates and migrates the database the `db` vitest project runs against.
#
# Idempotent: safe to re-run. `createdb` failing because the database already
# exists is the expected case on every run after the first, so that specific
# failure is tolerated and nothing else is.
set -euo pipefail

TEST_URL="${DATABASE_URL_TEST:-postgresql://transient@127.0.0.1:5544/transient_test?schema=public}"

# Strip the query string and pull the database name off the end of the path.
without_query="${TEST_URL%%\?*}"
db_name="${without_query##*/}"
admin_url="${without_query%/*}/postgres"

if [[ "$db_name" != *test* ]]; then
  echo "refusing: DATABASE_URL_TEST must name a database containing 'test', got '${db_name}'" >&2
  echo "the db tests truncate every table, so this guard is the only thing between a typo and the dev database" >&2
  exit 1
fi

echo "==> ensuring database '${db_name}' exists"
if psql "$admin_url" -tAc "SELECT 1 FROM pg_database WHERE datname = '${db_name}'" | grep -q 1; then
  echo "    already present"
else
  psql "$admin_url" -c "CREATE DATABASE \"${db_name}\""
  echo "    created"
fi

echo "==> applying migrations"
DATABASE_URL="$TEST_URL" npx prisma migrate deploy

echo "==> ready: ${db_name}"
