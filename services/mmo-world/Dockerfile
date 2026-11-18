# The world service (services/mmo-world): a static binary in a small image.
# Built from the repo root, like the other services; it copies only this
# module, whose sheets and setting pack ship beside the binary. Watch
# paths in railway.toml follow this COPY list.
FROM golang:1.27 AS build
WORKDIR /src
COPY services/mmo-world/go.mod services/mmo-world/go.sum ./
RUN go mod download
COPY services/mmo-world/ ./
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/world ./cmd/world \
 && CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/op ./cmd/op

FROM gcr.io/distroless/static-debian12:nonroot
WORKDIR /app
COPY --from=build /out/world /out/op /app/
COPY services/mmo-world/sheets /app/sheets
COPY services/mmo-world/packs /app/packs
ENV MMO_SHEETS_ROOT=/app
EXPOSE 8080
ENTRYPOINT ["/app/world"]
