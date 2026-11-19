#!/bin/sh
set -eu
for svc in ai embed mcp; do
  psql -v ON_ERROR_STOP=1 -U postgres <<SQL
CREATE ROLE $svc LOGIN PASSWORD 'dev-only-$svc';
CREATE DATABASE $svc OWNER $svc;
SQL
done
psql -v ON_ERROR_STOP=1 -U postgres -d embed -c 'CREATE EXTENSION vector'
