# GitHub Actions Workflows

This directory contains the CI/CD workflows for the Brackeys application.

## Workflows

### `deploy.yml` - Production Deployment

**Triggers:**
- Push to `main` branch
- Manual trigger via Actions tab

**What it does:**
1. Runs tests and linting
2. Triggers Portainer webhook
3. Waits for deployment
4. Runs health check

**Required Secrets:**
- `PORTAINER_WEBHOOK_URL` - Webhook URL from Portainer

**Duration:** ~2-3 minutes

### `pr-checks.yml` - Pull Request Validation

**Triggers:**
- Pull requests to `main` or `develop`

**What it does:**
1. Runs linting and formatting checks
2. Runs tests
3. Validates Flyway migrations against test database

**Required Secrets:**
- None (runs in isolated environment)

**Duration:** ~1-2 minutes

## How Deployment Works

```
Developer pushes to main
    ↓
GitHub Actions runs tests
    ↓
    ✅ Tests pass
    ↓
Trigger Portainer webhook
    ↓
Portainer at portainer.duxez.dev
    ↓
Pulls code from GitHub
    ↓
Builds Docker images
    ↓
Stops old containers
    ↓
Starts: PostgreSQL → Flyway → App → MinIO
    ↓
GitHub Actions health check
    ↓
✅ Deployment complete!
```

## No SSH Required!

Previous setup required:
- SSH keys
- File syncing with rsync
- Remote command execution

Current setup:
- ✅ Single webhook call
- ✅ Portainer handles everything
- ✅ More secure
- ✅ Simpler

## Monitoring Deployments

### Via GitHub
- Go to **Actions** tab
- Click on latest workflow run
- See real-time progress

### Via Portainer
- Go to `https://portainer.duxez.dev`
- Navigate to **Stacks** → `brackeys`
- See container status

## Troubleshooting

### Deployment Failed at Test Step
- Check the logs in Actions tab
- Fix failing tests
- Push again

### Webhook Failed
- Verify `PORTAINER_WEBHOOK_URL` secret is correct
- Test webhook manually:
  ```bash
  curl -X POST "YOUR_WEBHOOK_URL"
  ```

### Health Check Failed
- Check Portainer logs for container errors
- Verify application started correctly
- Check database migrations completed

## Adding New Workflows

To add a new workflow:

1. Create `new-workflow.yml` in this directory
2. Follow GitHub Actions syntax
3. Test with `workflow_dispatch` trigger first
4. Document it in this README

## Environment Variables

All application secrets are managed in **Portainer**, not GitHub Actions:
- Database passwords
- API keys
- Service credentials

Only the webhook URL is in GitHub Secrets.

## For More Information

See the full documentation:
- [Deployment Setup](../../docs/DEPLOYMENT_SETUP.md)
- [CI/CD with Flyway](../../docs/CICD_FLYWAY_DEPLOYMENT.md)
- [Portainer Quick Start](../../docs/PORTAINER_QUICK_START.md)

