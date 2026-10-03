import Link from 'next/link';
import { DeveloperTools } from '../../components/developer-tools';
import { Brand } from '../../components/brand';
export const metadata = { title: 'Developer guide' };
export default function Developers() {
  return (
    <>
      <header className="public-header">
        <Brand />
        <nav aria-label="Developer">
          <Link href="/login">Sign in</Link>
          <Link href="/dashboard">Dashboard</Link>
        </nav>
      </header>
      <main id="main" className="developer-content">
        <span className="eyebrow">DEVELOPER GUIDE</span>
        <h1>Build around a lasting identity.</h1>
        <p>Native opaque IDs, policy-filtered profiles and stable generated avatars.</p>
        <article className="card">
          <h2>Read a public profile</h2>
          <p>
            Public APIs disclose only fields permitting API access. Machine and agent
            representations enforce separate policies.
          </p>
          <pre>
            <code>
              {
                'GET /api/v1/profiles/alice\nGET /api/v1/profiles/alice?persona=professional\nGET /api/v1/profiles/alice?channel=machine'
              }
            </code>
          </pre>
        </article>
        <article className="card">
          <h2>Granular consent</h2>
          <p>
            Register an application. An identity owner grants scopes and fields. Use the resulting
            native consent token. Revocation is checked on every request.
          </p>
          <pre>
            <code>
              {
                'const response = await fetch(origin + "/api/v1/application/profile", {\n  headers: { Authorization: "Bearer " + consentToken }\n});\nif (!response.ok) throw new Error("Access unavailable");\nconst profile = await response.json();'
              }
            </code>
          </pre>
          <p>Native tokens are not OAuth/OIDC tokens. Public email-hash lookup is disabled.</p>
        </article>
        <article className="card">
          <h2>Avatar delivery</h2>
          <pre>
            <code>
              {
                '/avatar/idn_...?size=128&default=geometric&format=webp\n/avatar/alice?size=256&default=initials\n/avatar/unknown?default=404'
              }
            </code>
          </pre>
          <p>
            SVG, PNG, JPEG, WebP and AVIF. Sizes 16–1024. Private identities serve generated
            fallback.
          </p>
        </article>
        <article className="card">
          <h2>Webhook verification</h2>
          <p>
            Compute HMAC-SHA256(secret, timestamp + "." + rawBody). Compare in constant time, reject
            timestamps outside five minutes and deduplicate delivery IDs.
          </p>
          <pre>
            <code>
              {
                'X-Identity-Timestamp: <unix-seconds>\nX-Identity-Delivery: dlv_...\nX-Identity-Signature: <hex-hmac>'
              }
            </code>
          </pre>
        </article>
        <article className="card">
          <h2>Contracts and errors</h2>
          <p>
            Errors include code, message, status and request_id. Rate limits include Retry-After.
          </p>
          <Link className="text-link" href="/api/v1/openapi.json">
            Download OpenAPI document ↗
          </Link>
        </article>
        <DeveloperTools />
      </main>
    </>
  );
}
