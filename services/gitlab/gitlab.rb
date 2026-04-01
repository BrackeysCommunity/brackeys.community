# GitLab Omnibus Configuration
# https://docs.gitlab.com/omnibus/settings/configuration.html
#
# This file is baked into the Docker image at build time.
# Changes require a rebuild and redeploy.
# Runtime overrides can be set via GITLAB_OMNIBUS_CONFIG env var.

# External URL — set via EXTERNAL_URL env var in Railway
external_url ENV['EXTERNAL_URL'] || 'http://localhost'

# Ports — Railway handles routing, so listen on the port Railway expects
nginx['listen_port'] = ENV['PORT']&.to_i || 80
nginx['listen_https'] = false

# Disable built-in Let's Encrypt — Railway handles TLS termination
letsencrypt['enable'] = false

# Trust Railway's reverse proxy headers
nginx['real_ip_trusted_addresses'] = ['0.0.0.0/0']
nginx['real_ip_header'] = 'X-Forwarded-For'
nginx['real_ip_recursive'] = 'on'

# SSH — configure if needed, Railway doesn't support arbitrary TCP ports by default
gitlab_rails['gitlab_shell_ssh_port'] = 22

# Reduce memory footprint for smaller instances
puma['worker_processes'] = 2
sidekiq['concurrency'] = 5

# Prometheus monitoring — disable to save resources (optional)
prometheus_monitoring['enable'] = false

# Container registry — disable unless needed
registry['enable'] = false

# GitLab Pages — disable unless needed
pages_external_url nil
gitlab_pages['enable'] = false
