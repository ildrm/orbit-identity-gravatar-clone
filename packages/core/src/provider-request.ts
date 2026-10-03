import { safeHttps } from './outbound.js';
import { redis, rateLimit } from './redis.js';
import { digest, encrypt, decrypt } from './security.js';
import { DomainError } from './errors.js';

export async function githubAccount(token: string): Promise<unknown> {
  const identifier = digest(token),
    base = 'provider:github:' + identifier,
    r = redis();
  if (!(await rateLimit(base, 30, 60)).allowed)
    throw new DomainError(
      'PROVIDER_RATE_LIMIT',
      'Wait before refreshing this provider connection.',
      429,
    );
  if (await r.exists(base + ':open'))
    throw new DomainError(
      'PROVIDER_CIRCUIT_OPEN',
      'Provider connection is temporarily unavailable. Try again shortly.',
      503,
    );
  const cached = await r.get(base + ':profile');
  if (cached) {
    try {
      return JSON.parse(decrypt(cached)) as unknown;
    } catch {
      await r.del(base + ':profile');
      process.stderr.write('{"level":"warn","code":"PROVIDER_CACHE_REJECTED"}\n');
    }
  }
  let failure: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const result = await safeHttps('https://api.github.com/user', {
        headers: {
          Authorization: 'Bearer ' + token,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'Orbit-Identity',
        },
        maxBytes: 262_144,
      });
      if (result.status === 200) {
        const value: unknown = JSON.parse(result.body);
        await r.set(base + ':profile', encrypt(result.body), 'EX', 120);
        await r.del(base + ':failures');
        return value;
      }
      if (result.status === 401 || result.status === 403)
        throw new DomainError(
          'PROVIDER_AUTHORIZATION',
          'Provider authorization has expired or lacks permission. Reconnect explicitly.',
          502,
        );
      if (result.status === 429)
        throw new DomainError(
          'PROVIDER_RATE_LIMIT',
          'The provider has limited this connection. Try again later.',
          429,
        );
      if (result.status < 500)
        throw new DomainError(
          'PROVIDER_RESPONSE',
          'The provider returned an unsupported response.',
          502,
        );
      throw new DomainError(
        'PROVIDER_UNAVAILABLE',
        'Provider service is temporarily unavailable.',
        502,
      );
    } catch (error) {
      if (
        error instanceof DomainError &&
        [
          'PROVIDER_AUTHORIZATION',
          'PROVIDER_RATE_LIMIT',
          'PROVIDER_RESPONSE',
          'UNSAFE_DESTINATION',
          'RESPONSE_TOO_LARGE',
        ].includes(error.code)
      )
        throw error;
      failure = error;
      if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
  await r.eval(
    "local n=redis.call('INCR',KEYS[1]);redis.call('EXPIRE',KEYS[1],60);if n>=3 then redis.call('SET',KEYS[2],'1','EX',30) end;return n",
    2,
    base + ':failures',
    base + ':open',
  );
  if (failure instanceof DomainError) throw failure;
  throw new DomainError(
    'PROVIDER_UNAVAILABLE',
    'Provider network request failed. Try again later.',
    502,
  );
}
