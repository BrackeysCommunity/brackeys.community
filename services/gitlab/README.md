# GitLab CE — Railway Deployment

Self-hosted GitLab CE instance deployed on Railway.

## Architecture

Railway only supports a single volume mount per service. GitLab expects three paths:

| Path | Purpose | Strategy |
|---|---|---|
| `/etc/gitlab` | Configuration | Generated at runtime via entrypoint |
| `/var/opt/gitlab` | Data (repos, DB, uploads) | Railway volume mount |
| `/var/log/gitlab` | Logs | Ephemeral (not persisted) |

Configuration is built dynamically in `docker-entrypoint.sh` using Railway's injected
environment variables (`PORT`, `RAILWAY_PUBLIC_DOMAIN`, etc.) and exported as
`GITLAB_OMNIBUS_CONFIG`.

## Railway Setup

1. **Create service** — point at this repo, set root directory to `services/gitlab`
2. **Add a volume mount** — mount to `/var/opt/gitlab`
3. **Set environment variables**:
   - `GITLAB_ROOT_PASSWORD` — initial root password (first deploy only)
4. **Generate a domain** — Railway injects `RAILWAY_PUBLIC_DOMAIN` automatically
5. **Deploy** — GitLab takes several minutes to boot; healthcheck timeout is set to 7200s

## How It Works

- `railway.toml` configures the build (Dockerfile) and deploy (healthcheck, restart policy)
- `docker-entrypoint.sh` reads Railway env vars and builds `GITLAB_OMNIBUS_CONFIG` dynamically
- nginx listens on `$PORT` (Railway-assigned), HTTPS is off (Railway handles TLS)
- Puma and Workhorse are configured on internal ports (8081/8181)

## References

- Based on [vergissberlin/railwayapp-gitlab](https://github.com/vergissberlin/railwayapp-gitlab)
- [GitLab Docker Installation](https://docs.gitlab.com/install/docker/installation/)
