#!/bin/bash
# Run a command; if it fails, sleep and re-run it up to RETRY_EXTRA (default 2) more times.
# Usage: scripts/ci_retry.sh <command> [args...]
# The scripts this wraps resume from their on-disk caches (work/<chain>, gecko cache), so a re-run
# only redoes unfinished work. The last failure's exit code is returned: a command that keeps
# failing stays a failure (the chain-day is then NOT READY). Nothing is guessed or skipped.
# Env: RETRY_EXTRA (2), RETRY_SLEEP seconds (90).
extra=${RETRY_EXTRA:-2}; pause=${RETRY_SLEEP:-90}
attempt=0
while true; do
  attempt=$((attempt+1))
  "$@" && exit 0
  rc=$?
  if [ "$attempt" -gt "$extra" ]; then
    echo "::error::command failed after $attempt attempts (rc=$rc): $*"
    exit "$rc"
  fi
  echo "::warning::attempt $attempt failed (rc=$rc); sleeping ${pause}s then retrying: $*"
  sleep "$pause"
done
