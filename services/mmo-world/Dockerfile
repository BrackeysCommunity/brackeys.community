# The world service: a static binary in a small image, built from the repo
# root, with its sheets, packs and the Activity's build beside it.
# The default target is the service; `--target replay` builds the nightly
# replay (scripts/nightly-replay.sh): the operator CLI beside pg_dump and
# psql; `--target backup` builds the backups (scripts/backup.sh, and
# scripts/restore.sh for a restore): the operator CLI and the sheets op
# verify reads, beside pg_dump, pg_restore and psql.
FROM golang:1.27 AS build
WORKDIR /src
COPY services/mmo-world/go.mod services/mmo-world/go.sum ./
RUN go mod download
COPY services/mmo-world/ ./
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/world ./cmd/world \
 && CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/op ./cmd/op
# The book a world runs on until it takes this build's at an epoch, when
# the deploy carries one (scripts/epoch-root.sh); empty otherwise.
RUN mkdir -p /out/epoch-from \
 && if [ -d epoch-from/sheets ]; then cp -R epoch-from/sheets epoch-from/packs /out/epoch-from/; fi

# The Activity's static build, which the service serves on its Activity
# listener. It reads the API's generated types, the words it shares with
# chat, the pack's palette and names, and the sheet cells the mock gateway
# plays by, from where they sit in the repo.
FROM oven/bun:1.3 AS activity
WORKDIR /src
COPY packages/mmo-api packages/mmo-api
COPY packages/mmo-words packages/mmo-words
COPY services/mmo-world/packs/wasteland services/mmo-world/packs/wasteland
COPY services/mmo-world/sheets services/mmo-world/sheets
COPY services/mmo-activity services/mmo-activity
WORKDIR /src/services/mmo-activity
RUN bun install --frozen-lockfile && bun run build

# What both runtime images carry beside their binaries.
FROM scratch AS assets
COPY services/mmo-world/sheets /app/sheets
COPY services/mmo-world/packs /app/packs

FROM postgres:16-alpine AS replay
WORKDIR /app
COPY --from=build /out/op /usr/local/bin/op
COPY --from=assets /app /app
COPY services/mmo-world/scripts/nightly-replay.sh /usr/local/bin/nightly-replay
ENV MMO_SHEETS_ROOT=/app
ENTRYPOINT ["nightly-replay"]

FROM postgres:16-alpine AS backup
WORKDIR /app
COPY --from=build /out/op /usr/local/bin/op
COPY --from=assets /app /app
COPY services/mmo-world/scripts/backup.sh /usr/local/bin/backup
COPY services/mmo-world/scripts/restore.sh /usr/local/bin/restore
ENV MMO_SHEETS_ROOT=/app
ENTRYPOINT ["backup"]

FROM gcr.io/distroless/static-debian12:nonroot AS world
WORKDIR /app
COPY --from=build /out/world /out/op /app/
COPY --from=assets /app /app
COPY --from=build /out/epoch-from /app/epoch-from
COPY --from=activity /src/services/mmo-activity/dist /app/activity
ENV MMO_SHEETS_ROOT=/app
ENV MMO_ACTIVITY_DIR=/app/activity
EXPOSE 8080
ENTRYPOINT ["/app/world"]
