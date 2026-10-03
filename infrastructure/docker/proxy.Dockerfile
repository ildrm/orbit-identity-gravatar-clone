FROM nginx:1.31.0-alpine@sha256:2f07d83bf561b506400dc183b1b2003803e39efbd22451f848adaba14d28c7c7
ARG ALPINE_MIRROR=https://mirror.ps.kz/alpine
# Fixed upstream library releases required by the container vulnerability gate.
RUN printf '%s/v3.24/main\n%s/v3.24/community\n' "$ALPINE_MIRROR" "$ALPINE_MIRROR" > /etc/apk/repositories \
    && apk --timeout 30 add --no-cache 'libexpat=2.8.5-r0' 'pcre2=10.49-r0'
