#!/bin/sh
# Runtime injection of NEXT_PUBLIC_* env vars into the pre-built Next.js client bundle.
# At build time, these vars are set to placeholder strings.
# At container start, this script replaces them with real values from the environment.

set -e

NEXT_DIR="apps/web/.next"

# Replace __PLACEHOLDER_<NAME>__ tokens (used for vars not validated at build time)
inject_placeholder() {
  local placeholder="__PLACEHOLDER_${1}__"
  local value="${2}"
  if [ -n "$value" ]; then
    find "$NEXT_DIR" -name "*.js" -exec sed -i "s|${placeholder}|${value}|g" {} +
    echo "[entrypoint] Injected ${1}"
  fi
}

# Replace URL-shaped placeholders (used for vars validated as URLs at build time)
inject_url() {
  local placeholder="${1}"
  local value="${2}"
  if [ -n "$value" ]; then
    find "$NEXT_DIR" -name "*.js" -exec sed -i "s|${placeholder}|${value}|g" {} +
    echo "[entrypoint] Injected ${3}"
  fi
}

inject_url "https://build.placeholder.invalid" "$NEXT_PUBLIC_APP_URL" "NEXT_PUBLIC_APP_URL"
inject_placeholder "NEXT_PUBLIC_SUPABASE_URL" "$NEXT_PUBLIC_SUPABASE_URL"
inject_placeholder "NEXT_PUBLIC_SUPABASE_ANON_KEY" "$NEXT_PUBLIC_SUPABASE_ANON_KEY"

# exec is required — replaces the shell process so SIGTERM from Docker
# reaches Node directly for graceful shutdown. Do not remove.
exec node apps/web/server.js
