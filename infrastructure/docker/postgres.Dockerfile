FROM postgres:18.6-alpine@sha256:10a5c69a83035ab5239f5620d708520e8b28f5aa1f2b20143e6024532edadfb5
ARG ALPINE_MIRROR=https://mirror.ps.kz/alpine
# This official mirror preserves TLS and Alpine package signature verification.
RUN printf '%s/v3.24/main\n%s/v3.24/community\n' "$ALPINE_MIRROR" "$ALPINE_MIRROR" > /etc/apk/repositories \
    && apk --timeout 30 add --no-cache su-exec=0.3-r0 \
    && grep -q 'exec gosu postgres' /usr/local/bin/docker-entrypoint.sh \
    && sed -i 's/exec gosu postgres/exec su-exec postgres/' /usr/local/bin/docker-entrypoint.sh \
    && rm /usr/local/bin/gosu
