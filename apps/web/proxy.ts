import { NextRequest, NextResponse } from 'next/server';
export async function proxy(request: NextRequest) {
  let rewriteTarget: URL | undefined;
  const host = request.headers.get('host')?.split(':')[0]?.toLowerCase();
  const primaryHost = new URL(process.env.PUBLIC_ORIGIN ?? 'http://localhost:8080').hostname;
  if (host && host !== primaryHost && !request.nextUrl.pathname.startsWith('/_next/')) {
    const mapping = await fetch(
      (process.env.API_INTERNAL_URL ?? 'http://localhost:4000') +
        '/internal/custom-domains/route?domain=' +
        encodeURIComponent(host),
      { headers: { 'x-internal-api-key': process.env.INTERNAL_API_KEY ?? '' }, cache: 'no-store' },
    );
    if (!mapping.ok) return new NextResponse('Profile domain unavailable', { status: 404 });
    const tenant = (await mapping.json()) as { handle: string };
    if (request.nextUrl.pathname === '/' || request.nextUrl.pathname === '/u/' + tenant.handle) {
      const target = request.nextUrl.clone();
      target.pathname = '/u/' + tenant.handle;
      rewriteTarget = target;
    } else return new NextResponse('Profile domain unavailable', { status: 404 });
  }
  if (!rewriteTarget && /^\/u\/[a-zA-Z0-9_@-]{3,100}$/.test(request.nextUrl.pathname)) {
    const identifier = request.nextUrl.pathname.slice(3);
    const persona = request.nextUrl.searchParams.get('persona');
    const result = await fetch(
      (process.env.API_INTERNAL_URL ?? 'http://localhost:4000') +
        '/internal/profiles/' +
        encodeURIComponent(identifier) +
        (persona ? '?persona=' + encodeURIComponent(persona) : ''),
      {
        headers: { 'x-internal-api-key': process.env.INTERNAL_API_KEY ?? '' },
        cache: 'no-store',
      },
    );
    if (result.ok) {
      const profile = (await result.json()) as {
        canonicalHandle?: string;
        handle: string;
        persona: string | null;
      };
      if (profile.canonicalHandle)
        return new NextResponse(null, {
          status: 308,
          headers: {
            Location: new URL(
              '/u/' +
                profile.handle +
                (profile.persona ? '?persona=' + encodeURIComponent(profile.persona) : ''),
              process.env.PUBLIC_ORIGIN ?? request.nextUrl.origin,
            ).href,
            'Cache-Control': 'no-store',
            'Referrer-Policy': 'no-referrer',
          },
        });
    }
  }
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64'),
    development = process.env.NODE_ENV !== 'production';
  const csp =
    "default-src 'self'; script-src 'self' 'nonce-" +
    nonce +
    "'" +
    (development ? " 'unsafe-eval'" : '') +
    "; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self' " +
    (process.env.S3_PUBLIC_ENDPOINT ?? 'http://localhost:9000') +
    (development ? ' ws:' : '') +
    "; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'";
  const headers = new Headers(request.headers);
  headers.set('x-nonce', nonce);
  headers.set('Content-Security-Policy', csp);
  const response = rewriteTarget
    ? NextResponse.rewrite(rewriteTarget, { request: { headers } })
    : NextResponse.next({ request: { headers } });
  response.headers.set('Content-Security-Policy', csp);
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (request.nextUrl.protocol === 'https:')
    response.headers.set('Strict-Transport-Security', 'max-age=31536000');
  return response;
}
export const config = {
  matcher: ['/((?!api|avatar|assets|_next/static|_next/image|favicon.ico).*)'],
};
