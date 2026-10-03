import Link from 'next/link';
export function Brand() {
  return (
    <Link href="/" className="brand" aria-label="Orbit Identity home">
      <span className="brand-mark" aria-hidden="true">
        <span />
      </span>
      <span>
        orbit<span className="brand-sub">identity</span>
      </span>
    </Link>
  );
}
