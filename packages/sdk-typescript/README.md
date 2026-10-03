# Orbit Identity SDK

Build from the repository with `npm run build:server && node scripts/build-sdks.mjs`, then `npm pack --workspace @orbit-identity/sdk`. Install the resulting tarball. The package contains ESM JavaScript and declarations; Node 22 or later and modern browsers provide fetch.

```ts
import { IdentityClient, IdentityApiError } from '@orbit-identity/sdk';
const client = new IdentityClient('https://identity.example.org');
const profile = await client.profile('alice');
for await (const person of client.search('Alice')) console.log(person.handle);
```

Provide an explicitly consented native grant or OAuth access token as the second constructor argument. `oauthProfile()` uses OAuth; `consentedProfile()` uses native grants. GET requests retry transient server failures at most twice, have bounded deadlines and reject redirects. Mutations require explicit method/body and are never automatically retried. Handle typed status/code/requestId errors; do not log tokens or private profile values. REST and SDK versions are 1.x.
