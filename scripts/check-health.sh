#!/usr/bin/env bash
# Smoke test: checks every service in the stack is reachable from the host.
# Usage: ./scripts/check-health.sh
set -uo pipefail

API_URL="${API_URL:-http://localhost:3001/api}"
FRONTEND_URL="${FRONTEND_URL:-http://localhost:3000}"
ES_URL="${ES_URL:-http://localhost:9200}"
KIBANA_URL="${KIBANA_URL:-http://localhost:5601}"

failures=0

check() {
  local name="$1" url="$2"
  local code
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$url")
  if [[ "$code" == "200" ]]; then
    printf '  \033[32m✔\033[0m %-22s %s\n' "$name" "$url"
  else
    printf '  \033[31m✘\033[0m %-22s %s (HTTP %s)\n' "$name" "$url" "${code:-none}"
    failures=$((failures + 1))
  fi
}

echo "CryptoScope health check"
check "API liveness"        "$API_URL/health"
check "API readiness"       "$API_URL/health/ready"
check "Frontend"            "$FRONTEND_URL"
check "Elasticsearch"       "$ES_URL/_cluster/health"
check "Kibana"              "$KIBANA_URL/api/status"

echo
echo "Readiness detail:"
curl -s --max-time 5 "$API_URL/health/ready" | (command -v jq >/dev/null && jq . || cat)
echo

if [[ $failures -gt 0 ]]; then
  echo "$failures check(s) failed."
  exit 1
fi
echo "All checks passed."
