FROM gitlab/gitlab-ce:19.4.0-ce.0@sha256:a948f7a7ed49ae469fb2bfed9fd75fa4f44b3f098e1dfd33b223bd5487068518

COPY --chmod=0755 docker-entrypoint.sh /usr/local/bin/railway-gitlab-entrypoint

CMD ["/usr/local/bin/railway-gitlab-entrypoint"]
