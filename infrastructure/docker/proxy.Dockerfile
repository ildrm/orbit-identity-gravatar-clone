FROM nginx:1.31.7-alpine@sha256:892bb2152464f0c5d8972593a5f5afaf8054552580b699d95f8ff4af08c2d33d
ARG ALPINE_MIRROR=https://mirror.ps.kz/alpine
# Fixed upstream library releases required by the container vulnerability gate.
RUN printf '%s/v3.24/main\n%s/v3.24/community\n' "$ALPINE_MIRROR" "$ALPINE_MIRROR" > /etc/apk/repositories \
    && apk --timeout 30 add --no-cache 'libexpat=2.8.5-r0' 'pcre2=10.49-r0'
