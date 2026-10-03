FROM postgres:18.6-alpine@sha256:77f585114c32fbca283dc835b0596f4e52b51b4c6662d7810b2f4084f60a1873
ARG ALPINE_MIRROR=https://mirror.ps.kz/alpine
# This official mirror preserves TLS and Alpine package signature verification.
RUN printf '%s/v3.24/main\n%s/v3.24/community\n' "$ALPINE_MIRROR" "$ALPINE_MIRROR" > /etc/apk/repositories \
    && apk --timeout 30 add --no-cache su-exec=0.3-r0 \
    && grep -q 'exec gosu postgres' /usr/local/bin/docker-entrypoint.sh \
    && sed -i 's/exec gosu postgres/exec su-exec postgres/' /usr/local/bin/docker-entrypoint.sh \
    && rm /usr/local/bin/gosu
