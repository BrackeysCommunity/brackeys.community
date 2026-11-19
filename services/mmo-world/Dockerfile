# The world service: a static binary in a small image, built from the repo
# root. It copies only this module; sheets and packs ship beside the binary.
# The default target is the service; `--target replay` builds the nightly
# replay (scripts/nightly-replay.sh): the operator CLI beside pg_dump and
# psql.
FROM golang:1.27 AS build
WORKDIR /src
COPY services/mmo-world/go.mod services/mmo-world/go.sum ./
RUN go mod download
COPY services/mmo-world/ ./
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/world ./cmd/world \
 && CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/op ./cmd/op

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

FROM gcr.io/distroless/static-debian12:nonroot AS world
WORKDIR /app
COPY --from=build /out/world /out/op /app/
COPY --from=assets /app /app
ENV MMO_SHEETS_ROOT=/app
EXPOSE 8080
ENTRYPOINT ["/app/world"]
