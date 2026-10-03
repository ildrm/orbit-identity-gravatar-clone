import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { IdentityClient, IdentityApiError } from '../../packages/sdk-typescript/src/index.js';
describe('TypeScript SDK against a real HTTP contract', () => {
  let server: Server,
    origin: string,
    attempts = 0;
  beforeAll(async () => {
    server = createServer((req, res) => {
      res.setHeader('Content-Type', 'application/json');
      if (req.url === '/api/v1/profiles/retry') {
        attempts++;
        if (attempts < 3) {
          res.writeHead(503);
          res.end(JSON.stringify({ code: 'UNAVAILABLE' }));
          return;
        }
        res.end(JSON.stringify({ id: 'idn_test', displayName: 'After retry' }));
        return;
      }
      if (req.url?.startsWith('/api/v1/search')) {
        const u = new URL(req.url, 'http://localhost');
        res.end(
          JSON.stringify(
            u.searchParams.has('cursor')
              ? { items: [{ id: 'b', handle: 'second' }], nextCursor: null }
              : { items: [{ id: 'a', handle: 'first' }], nextCursor: 'a' },
          ),
        );
        return;
      }
      if (req.url === '/api/v1/application/profile') {
        if (req.headers.authorization === 'Bearer allowed') {
          res.end(JSON.stringify({ id: 'consented' }));
          return;
        }
        res.writeHead(401);
        res.end(
          JSON.stringify({
            code: 'INVALID_TOKEN',
            request_id: 'test-request',
            message: 'Access denied',
          }),
        );
        return;
      }
      if (req.url === '/api/v1/profiles/redirect') {
        res.writeHead(302, { Location: origin + '/stolen' });
        res.end();
        return;
      }
      res.writeHead(404);
      res.end(
        JSON.stringify({
          code: 'NOT_FOUND',
          request_id: 'request-404',
          message: 'Profile unavailable',
        }),
      );
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    origin = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
  });
  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  it('retries transient GET errors and returns server data', async () => {
    expect((await new IdentityClient(origin).profile('retry')).displayName).toBe('After retry');
    expect(attempts).toBe(3);
  });
  it('iterates cursor pages', async () => {
    const result = [];
    for await (const item of new IdentityClient(origin).search('demo')) result.push(item.handle);
    expect(result).toEqual(['first', 'second']);
  });
  it('passes scoped bearer credentials', async () => {
    expect((await new IdentityClient(origin, 'allowed').consentedProfile()).id).toBe('consented');
  });
  it('preserves error code and request ID', async () => {
    try {
      await new IdentityClient(origin).consentedProfile();
      throw new Error('Expected failure');
    } catch (e) {
      expect(e).toBeInstanceOf(IdentityApiError);
      expect(e).toMatchObject({ status: 401, code: 'INVALID_TOKEN', requestId: 'test-request' });
    }
  });
  it('rejects redirects and unsafe origins', async () => {
    await expect(new IdentityClient(origin, 'allowed').profile('redirect')).rejects.toThrow();
    expect(() => new IdentityClient('https://user:password@example.com')).toThrow();
    expect(() => new IdentityClient('http://remote.example.com')).toThrow();
  });
});
