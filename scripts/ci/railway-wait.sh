#!/bin/sh
# Wait for the newest Railway deployment of one service to reach a terminal
# status. Used by the five deploy jobs in .gitlab/release.gitlab-ci.yml.
#
#   railway-wait.sh <service> <environment>
#
# TIMEOUT_SECONDS (default 1800) bounds the wait. media-scan is the long pole:
# its image bakes a ~750 MB model on every build.
#
# `railway up --ci` already exits non-zero on a failed deployment, so this is a
# confirmation and a log dumper rather than the only check — but it is also the
# thing that catches a deployment that never leaves BUILDING.
set -eu

SERVICE="${1:?usage: railway-wait.sh <service> <environment>}"
ENVIRONMENT="${2:?usage: railway-wait.sh <service> <environment>}"
TIMEOUT_SECONDS="${TIMEOUT_SECONDS:-1800}"
POLL_SECONDS="${POLL_SECONDS:-10}"

elapsed=0
last_status=""

while [ "$elapsed" -lt "$TIMEOUT_SECONDS" ]; do
  status=$(
    railway deployment list --service "$SERVICE" --environment "$ENVIRONMENT" --json 2>/dev/null |
      jq -r 'if type == "array" then .[0] else (.deployments // .edges // [])[0] end
             | (.node // .) | .status // empty'
  ) || status=""

  if [ -n "$status" ] && [ "$status" != "$last_status" ]; then
    echo "  [${elapsed}s] $SERVICE: $status"
    last_status="$status"
  fi

  case "$status" in
    SUCCESS)
      echo "✓ $SERVICE deployed to $ENVIRONMENT"
      exit 0
      ;;
    FAILED | CRASHED)
      echo "✗ $SERVICE deployment $status — build log follows"
      railway logs --build --service "$SERVICE" --environment "$ENVIRONMENT" 2>&1 | tail -200 || true
      exit 1
      ;;
  esac

  sleep "$POLL_SECONDS"
  elapsed=$((elapsed + POLL_SECONDS))
done

echo "✗ $SERVICE did not reach SUCCESS within ${TIMEOUT_SECONDS}s (last status: ${last_status:-unknown})"
railway logs --build --service "$SERVICE" --environment "$ENVIRONMENT" 2>&1 | tail -200 || true
exit 1
