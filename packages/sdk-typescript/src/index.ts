import type { PublicProfile, ApiError } from './contracts.js';
export type { PublicProfile, PublicClaim, ApiError, Policy } from './contracts.js';
export class IdentityApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    public requestId: string,
    message: string,
  ) {
    super(message);
    this.name = 'IdentityApiError';
  }
}
export type ResolverType = 'native' | 'domain' | 'email' | 'github' | 'did';
export interface Resolution {
  profile: PublicProfile;
  resolution: {
    adapter: ResolverType;
    provenance: string;
    fallback: string;
    cache: string;
    externalFetch: boolean;
  };
}
export class IdentityClient {
  private origin: string;
  constructor(
    origin: string,
    private token?: string,
    private timeoutMs = 5000,
  ) {
    const u = new URL(origin);
    if (
      u.username ||
      u.password ||
      (u.protocol !== 'https:' &&
        !(u.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(u.hostname)))
    )
      throw new Error('Use HTTPS or a loopback development origin');
    if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000)
      throw new Error('Use a timeout between 1 and 60000 milliseconds');
    this.origin = u.origin;
  }
  async request<T>(
    path: string,
    options: { method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'; body?: unknown } = {},
  ): Promise<T> {
    if (!path.startsWith('/') || path.startsWith('//') || path.includes('#'))
      throw new Error('Use an API path beginning with one slash');
    const method = options.method ?? 'GET';
    let attempt = 0;
    while (true) {
      const controller = new AbortController(),
        timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const response = await fetch(this.origin + '/api/v1' + path, {
          method,
          headers: {
            Accept: 'application/json',
            ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
            ...(this.token ? { Authorization: 'Bearer ' + this.token } : {}),
          },
          ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
          signal: controller.signal,
          redirect: 'error',
        });
        if (response.status >= 500 && method === 'GET' && attempt++ < 2) {
          await new Promise((r) => setTimeout(r, 100 * 2 ** attempt));
          continue;
        }
        const text = await response.text();
        if (text.length > 2 * 1024 * 1024)
          throw new IdentityApiError(
            response.status,
            'RESPONSE_TOO_LARGE',
            '',
            'API response exceeded the SDK limit.',
          );
        let body: unknown;
        try {
          body = text ? JSON.parse(text) : null;
        } catch {
          throw new IdentityApiError(
            response.status,
            'INVALID_RESPONSE',
            response.headers.get('X-Request-ID') ?? '',
            'API returned an unexpected representation.',
          );
        }
        if (!response.ok) {
          const e = (body ?? {}) as Partial<ApiError> & {
            error?: string;
            error_description?: string;
          };
          throw new IdentityApiError(
            response.status,
            e.code ?? e.error ?? 'REQUEST_FAILED',
            e.request_id ?? '',
            e.message ?? e.error_description ?? 'Request failed',
          );
        }
        return body as T;
      } catch (error) {
        if (error instanceof IdentityApiError) throw error;
        if (controller.signal.aborted)
          throw new IdentityApiError(0, 'TIMEOUT', '', 'API request exceeded its deadline.');
        throw new IdentityApiError(0, 'TRANSPORT_ERROR', '', 'API transport failed.');
      } finally {
        clearTimeout(timer);
      }
    }
  }
  profile(identifier: string, persona?: string): Promise<PublicProfile> {
    return this.request(
      '/profiles/' +
        encodeURIComponent(identifier) +
        (persona ? '?persona=' + encodeURIComponent(persona) : ''),
    );
  }
  consentedProfile(): Promise<PublicProfile> {
    return this.request('/application/profile');
  }
  oauthProfile(): Promise<PublicProfile> {
    return this.request('/oauth/profile');
  }
  oauthCredentials(): Promise<{ credentials: { id: string; credential: string }[] }> {
    return this.request('/oauth/credentials');
  }
  resolve(type: ResolverType, identifier: string): Promise<Resolution> {
    return this.request('/resolve?' + new URLSearchParams({ type, identifier }));
  }
  async *search(
    term: string,
  ): AsyncGenerator<{ id: string; handle: string; display_name: string; type: string }> {
    let cursor: string | null = '';
    const seen = new Set<string>();
    do {
      const page: {
        items: { id: string; handle: string; display_name: string; type: string }[];
        nextCursor: string | null;
      } = await this.request<{
        items: { id: string; handle: string; display_name: string; type: string }[];
        nextCursor: string | null;
      }>(
        '/search?q=' +
          encodeURIComponent(term) +
          (cursor ? '&cursor=' + encodeURIComponent(cursor) : ''),
      );
      yield* page.items;
      cursor = page.nextCursor;
      if (cursor && seen.has(cursor))
        throw new IdentityApiError(0, 'INVALID_CURSOR', '', 'API repeated a pagination cursor.');
      if (cursor) seen.add(cursor);
    } while (cursor);
  }
  avatarUrl(identifier: string, size = 128): string {
    if (!Number.isInteger(size) || size < 16 || size > 1024)
      throw new Error('Use avatar size 16–1024');
    return this.origin + '/avatar/' + encodeURIComponent(identifier) + '?size=' + size;
  }
}
