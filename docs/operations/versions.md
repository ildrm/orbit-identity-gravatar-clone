# Dependency and image provenance

Verified in the implementation environment on 2026-10-03. Exact JavaScript versions and SHA-512 artifact integrity are recorded in package-lock.json. These are the versions exercised here; this document does not assert that every component is the latest available patch indefinitely.

| Component                 | Exercised version    | Primary artifact/source                                                                      |
| ------------------------- | -------------------- | -------------------------------------------------------------------------------------------- |
| Node container runtime    | 24.21.0, Alpine 3.24 | [Official Node image sources](https://github.com/nodejs/docker-node/tree/main/24/alpine3.24) |
| Local Node runtime        | 24.18.0              | Installed executable                                                                         |
| Next.js                   | 16.3.8               | [Registry artifact](https://registry.npmjs.org/next/16.3.8)                                  |
| NestJS core               | 12.1.2               | [Registry artifact](https://registry.npmjs.org/@nestjs%2fcore/12.1.2)                        |
| React                     | 19.3.0               | [Registry artifact](https://registry.npmjs.org/react/19.3.0)                                 |
| TypeScript                | 6.0.3                | [Registry artifact](https://registry.npmjs.org/typescript/6.0.3)                             |
| PostgreSQL                | 18.6 Alpine          | [Official image/entrypoint sources](https://github.com/docker-library/postgres)              |
| Redis                     | 8.10.2 Alpine        | [Official image sources](https://github.com/redis/docker-library-redis)                      |
| SeaweedFS                 | 4.48                 | [Upstream releases](https://github.com/seaweedfs/seaweedfs/releases)                         |
| Nginx                     | 1.30.5 Alpine        | [Official image sources](https://github.com/nginx/docker-nginx)                              |
| Mailpit, development only | 1.31.3               | [Upstream releases](https://github.com/axllent/mailpit/releases)                             |
| Prometheus, optional      | 3.15.0               | [Upstream releases](https://github.com/prometheus/prometheus/releases)                       |
| Trivy                     | 0.75.0               | [Upstream releases](https://github.com/aquasecurity/trivy/releases)                          |
| Gitleaks                  | 8.30.1               | [Official image instructions](https://github.com/gitleaks/gitleaks)                          |

TypeScript 6 is retained because the checked typescript-eslint version does not support the newer TypeScript major in this environment. This compatibility exception is deliberate. Libraries are pinned to exact versions, while Dependabot proposes updates. GitHub Actions use full commit SHAs; scripts/action-pins.mjs reads upstream release metadata for reviewing new pins.

## Container security corrections

Application runtime images use Alpine 3.24 and remove the unused global npm/Yarn toolchain. Native Sharp, Argon2 and Next.js modules were rebuilt for the same Alpine runtime and tested through actual image processing, password/MFA and browser journeys.

The upstream PostgreSQL image carries an older Go-built gosu helper. The derived PostgreSQL image retains the official database and initialization behavior, replaces that helper with Alpine su-exec, and explicitly patches the one privilege-switch call. [su-exec's upstream contract](https://github.com/ncopa/su-exec) supports direct user/group switching and exec. Database initialization, effective user, migrations and restore must pass after this change.

The derived proxy image pins patched libexpat 2.8.5-r0 and pcre2 10.49-r0. [Nginx's upstream documentation](https://nginx.org/en/docs/http/ngx_http_upstream_module.html#server) describes runtime DNS resolution; the shared upstream zones and Docker DNS resolver permit container IP changes after rebuilds.

Run scripts/security-scan.mjs and inspect its current results before releasing. Reports include a production CycloneDX SBOM, npm audit, redacted source secret scan, and high/critical scans of API, web, admin, PostgreSQL, Redis, storage, proxy and TLS images. Development Mailpit, optional Prometheus and the host OS are outside that image scan scope. The final release report records the actual outcome, including any pending failure.

Validated application base images and core infrastructure images now use SHA-256 manifest digest pins in the Dockerfiles/Compose file. su-exec is pinned to 0.3-r0, and proxy fixes use exact package revisions. The build uses a reachable mirror from [Alpine’s official list](https://mirrors.alpinelinux.org/) while retaining TLS and signature verification. The local release manifest binds immutable image tags to the recorded image IDs and source SHA-256. Registry publication, organization-trusted signing and remote CI execution require the operator's registry, signing identity and repository configuration; those external actions have not been performed.
