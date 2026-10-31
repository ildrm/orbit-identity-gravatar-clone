FROM golang:1.27.3-alpine3.24@sha256:d200d2dd76b03a99b52651fd1325aff7dcd35422c35c01bac56571b0507f3deb AS build
ENV CGO_ENABLED=0 GOTOOLCHAIN=local
ARG GOPROXY=https://proxy.golang.org|https://goproxy.io|https://goproxy.cn,direct
ENV GOPROXY=$GOPROXY
# Versioned upstream module pins its dependency graph; Go verifies sum.golang.org checksums.
RUN --mount=type=cache,target=/go/pkg/mod --mount=type=cache,target=/root/.cache/go-build go install -trimpath -ldflags="-s -w" github.com/caddyserver/caddy/v2/cmd/caddy@v2.11.6
FROM alpine:3.24@sha256:294b683cb724975bec92580e1e685676bd4b50bda910ddb8c51d4cabeaec77e6
COPY --from=build /go/bin/caddy /usr/bin/caddy
RUN addgroup -g 10001 orbit && adduser -D -u 10001 -G orbit orbit && mkdir -p /data /config && chown -R orbit:orbit /data /config
ENV XDG_CONFIG_HOME=/config XDG_DATA_HOME=/data
USER 10001:10001
EXPOSE 80 443 443/udp
ENTRYPOINT ["/usr/bin/caddy"]
CMD ["run","--config","/etc/caddy/Caddyfile","--adapter","caddyfile"]
