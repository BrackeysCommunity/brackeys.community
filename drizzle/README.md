# Drizzle migrations

SQL migrations for the Brackeys schema. Generated with `bun run atlas:diff`
(see `scripts/atlas-diff.sh`) and applied to staging / prod via the
`.gitlab/atlas-staging.gitlab-ci.yml` and `.gitlab/atlas-prod.gitlab-ci.yml`
pipelines on `main` and `prod` respectively.

`atlas.sum` tracks file hashes — do not edit existing migrations after they
have been applied.
