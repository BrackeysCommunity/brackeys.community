FROM gitlab/gitlab-ce:latest

# Copy config into the image so it persists without a volume mount
COPY gitlab.rb /etc/gitlab/gitlab.rb

# Expose HTTP port (Railway will route to this)
EXPOSE 80

# The base image already defines the entrypoint and CMD
