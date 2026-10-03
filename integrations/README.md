# Developer integration guide

## Packaged clients

Build with npm run build:sdks and verify distribution contents with node scripts/verify-sdk-packages.mjs. TypeScript/JavaScript package @orbit-identity/sdk includes ESM JavaScript, declarations, copied public contracts, documentation and the GPL license. @orbit-identity/ui provides React avatar/card components. Python packaging lives in integrations/python/pyproject.toml; PHP has composer.json and IdentityClient.php. All retain the repository license.

```ts
import { IdentityClient } from '@orbit-identity/sdk';
const client = new IdentityClient('https://identity.example');
const profile = await client.profile('native_handle');
const result = await client.resolve('native', 'native_handle');
```

Read clients have bounded HTTP deadlines, typed errors and retries limited to safe GET requests. Cursor iteration rejects repeated cursors. HTTPS is required except explicit loopback development. Native ic_ consent and OAuth oa_ access tokens are separate; use consentedProfile/oauthProfile and the corresponding selected credential API. Never print or embed tokens in public URLs.

Private avatar URLs returned by a granted profile require Authorization. Fetch binary bytes from /api/v1/application/avatar or /api/v1/oauth/avatar with the same token; use the returned no-store response privately. A normal img element cannot attach a bearer header. Revoke object URLs when displaying fetched bytes. Public React avatar components use only public avatar endpoints.

## CLI

Set ORBIT_ORIGIN and optionally ORBIT_TOKEN, then run:

```sh
node integrations/cli/orbit.mjs profile HANDLE
node integrations/cli/orbit.mjs resolve native HANDLE
node integrations/cli/orbit.mjs search QUERY
node integrations/cli/orbit.mjs whoami
```

Resolver types are native/domain/email/github/did. Own verified email lookup requires account authentication; public email-hash resolution is disabled. CLI errors preserve safe request correlation; tokens are not printed.

## WordPress

Copy the entire integrations/wordpress directory into wp-content/plugins/orbit-identity and activate the plugin. Configure the public HTTPS instance under Settings. Bind a WordPress user to an explicit native handle or ID through their profile controls. Native users, comments, author avatars and supported email input resolve through that local binding; email/hash values are never sent to Orbit.

The integration includes author cards, a registered Gutenberg profile block, BuddyPress avatar hook, a local nontracking fallback, WP-CLI binding commands, and permission-checked REST binding/profile routes. User-profile writes verify nonces. Administrators can manage bindings; ordinary users can only bind themselves. HTTP transport forbids redirects, requires safe HTTPS, bounds timeout/size and preserves no-store for dynamic profile responses.

Public cards escape all provider/profile text using WordPress escaping. Private profile data and credentials are not loaded by the plugin. Generic WordPress get_avatar_data covers standard themes and consumer paths; no special WooCommerce extension is required or advertised.

Runtime validation uses official pinned WordPress core and a disposable MariaDB instance:

```sh
node scripts/download-wordpress.mjs
python3 scripts/extract-wordpress.py
node scripts/wordpress-runtime.mjs
```

The suite checks actual WordPress users/comments/authors, REST permission/nonces, block and BuddyPress registration, escaping, bounded HTTP configuration and real private-address SSRF denial. The public profile payload is a controlled fixture for escaping; a live external HTTPS Orbit deployment is a separate deployment test.

## Protocols

See the [API guide](../docs/api.md) and [protocol guide](../docs/protocols.md) for PKCE, refresh/revocation, native grants, webhook raw-body signing/idempotency, Orbit federation v1 and VC/DID boundaries. Public protocols never imply control over an entire account or universally verified person.
