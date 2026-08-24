#!/usr/bin/env bash
set -Eeuo pipefail

ORIGINAL_COMMAND="${SSH_ORIGINAL_COMMAND:-}"
if [[ ! "$ORIGINAL_COMMAND" =~ ^deploy-datcom\ ([0-9a-f]{40})$ ]]; then
  echo "Only deploy-datcom <commit-sha> is allowed." >&2
  exit 64
fi

exec /var/www/datcom/scripts/deploy.sh "${BASH_REMATCH[1]}"
