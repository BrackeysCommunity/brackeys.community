# GitLab CE — Railway Deployment

Self-hosted GitLab CE instance deployed on Railway.

## Architecture

Railway only supports a single volume mount per service. GitLab expects three paths:

| Path | Purpose | Strategy |
|---|---|---|
| `/etc/gitlab` | Configuration | Baked into Docker image via `COPY` |
| `/var/opt/gitlab` | Data (repos, DB, uploads) | Railway volume mount |
| `/var/log/gitlab` | Logs | Ephemeral (not persisted) |

## Railway Setup

1. **Point Railway at this Dockerfile** — set the service root to `services/gitlab`
2. **Add a volume mount** — mount to `/var/opt/gitlab`
3. **Set environment variables**:
   - `EXTERNAL_URL` — your GitLab URL (e.g., `https://gitlab.yourdomain.com`)
   - `GITLAB_ROOT_PASSWORD` — initial root password (first deploy only)
4. **Deploy**

## Configuration Changes

Edit `gitlab.rb` in this directory, commit, and redeploy. The config is baked into the image at build time.

For runtime overrides without rebuilding, set the `GITLAB_OMNIBUS_CONFIG` environment variable in Railway:

```
GITLAB_OMNIBUS_CONFIG=external_url 'https://new-url.example.com'; gitlab_rails['lfs_enabled'] = true
```

## Resources

- [GitLab Docker Installation](https://docs.gitlab.com/install/docker/installation/)
- [GitLab Docker Configuration](https://docs.gitlab.com/install/docker/configuration/)
