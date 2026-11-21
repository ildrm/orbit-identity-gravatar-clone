FROM nginx:1.31.8-alpine@sha256:fed7e14be83cbd2661a75cdc5b872d936cf155d46c327084d30b8df19ae88d72
ARG ALPINE_MIRROR=https://mirror.ps.kz/alpine
# Fixed upstream library releases required by the container vulnerability gate.
RUN printf '%s/v3.24/main\n%s/v3.24/community\n' "$ALPINE_MIRROR" "$ALPINE_MIRROR" > /etc/apk/repositories \
    && apk --timeout 30 add --no-cache 'libexpat=2.8.5-r0' 'pcre2=10.49-r0'
