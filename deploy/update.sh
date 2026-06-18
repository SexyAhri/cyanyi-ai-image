#!/usr/bin/env sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

cd "$SCRIPT_DIR"

docker compose pull
docker compose up -d
docker image prune -f
