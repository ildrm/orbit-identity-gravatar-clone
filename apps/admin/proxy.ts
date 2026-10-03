import { NextRequest, NextResponse } from 'next/server';
export function proxy(request: NextRequest) {
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
  const response = NextResponse.next({ request: { headers } });
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
