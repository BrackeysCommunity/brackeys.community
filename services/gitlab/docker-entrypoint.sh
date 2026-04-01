#!/usr/bin/env bash
set -euo pipefail

PORT="${PORT:-8080}"
HOST="${RAILWAY_PUBLIC_DOMAIN:-${RAILWAY_PRIVATE_DOMAIN:-localhost}}"
ROOT_PASSWORD="${GITLAB_ROOT_PASSWORD:-}"

# Build omnibus config dynamically from Railway environment
omnibus="external_url 'https://${HOST}';"
omnibus+=" nginx['listen_port']=${PORT};"
omnibus+=" nginx['listen_https']=false;"
omnibus+=" nginx['listen_addresses']=['0.0.0.0','[::]'];"
omnibus+=" gitlab_rails['allowed_hosts']=['${HOST}','healthcheck.railway.app','localhost','localhost:8080','127.0.0.1','127.0.0.1:8081'];"
omnibus+=" gitlab_rails['initial_gitlab_product_usage_data']=false;"
omnibus+=" gitlab_rails['gitlab_default_theme']=2;"
omnibus+=" gitlab_workhorse['listen_network']='tcp';"
omnibus+=" gitlab_workhorse['listen_addr']='0.0.0.0:8181';"

# Puma & Sidekiq tuning for Railway
omnibus+=" puma['worker_processes']=0;"
omnibus+=" puma['listen']='127.0.0.1';"
omnibus+=" puma['port']=8081;"
omnibus+=" sidekiq['max_concurrency']=10;"

# Disable services we don't need
omnibus+=" prometheus_monitoring['enable']=false;"
omnibus+=" registry['enable']=false;"
omnibus+=" gitlab_pages['enable']=false;"
omnibus+=" letsencrypt['enable']=false;"

# Set initial root password if provided
if [ -n "$ROOT_PASSWORD" ]; then
  omnibus+=" gitlab_rails['initial_root_password']='${ROOT_PASSWORD}';"
fi

export GITLAB_OMNIBUS_CONFIG="$omnibus"

exec /assets/init-container
