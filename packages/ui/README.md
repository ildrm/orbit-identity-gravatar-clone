# Orbit Identity React components

Build with `node scripts/build-sdks.mjs`, then `npm pack --workspace @orbit-identity/ui`. Install the tarball alongside React 19+. ESM declarations and individually exported components support tree shaking. Components inherit CSS so your application controls colors, focus styles and typography.

```tsx
import { IdentityAvatar, ProfileCard } from '@orbit-identity/ui';
<IdentityAvatar origin="https://identity.example.org" identityId="idn_..." alt="Alice avatar" />;
```

Use `ProfileHoverCard` for keyboard-accessible expandable details, `PersonaPicker` for explicit context and `ConsentDialog` for clearly named requested fields. Render only API-permitted profile data. An accessible consent component does not replace authorization-server consent validation.
