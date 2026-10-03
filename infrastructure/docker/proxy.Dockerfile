FROM nginx:1.30.5-alpine@sha256:0985e772fb9f729e6fa0980da05fca5d9c468e870eed43071545afa9d2e27d94
ARG ALPINE_MIRROR=https://mirror.ps.kz/alpine
# Fixed upstream library releases required by the container vulnerability gate.
RUN printf '%s/v3.24/main\n%s/v3.24/community\n' "$ALPINE_MIRROR" "$ALPINE_MIRROR" > /etc/apk/repositories \
    && apk --timeout 30 add --no-cache 'libexpat=2.8.5-r0' 'pcre2=10.49-r0'
