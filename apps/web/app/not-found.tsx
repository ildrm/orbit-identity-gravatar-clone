import Link from 'next/link';
export default function NotFound() {
  return (
    <main id="main" className="auth-page">
      <h1>This profile is unavailable.</h1>
      <p>It may be private, removed, or the address may have changed.</p>
      <Link href="/" className="button primary">
        Go to Orbit
      </Link>
    </main>
  );
}
