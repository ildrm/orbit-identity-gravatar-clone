import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { request } from 'node:https';
import { DomainError } from './errors.js';
export function publicAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const parts = address.split('.').map(Number);
    const a = parts[0]!,
      b = parts[1]!;
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 168 || b === 0)) ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 198 && (b === 18 || b === 19 || b === 51)) ||
      (a === 203 && b === 0)
    );
  }
  if (isIP(address) === 6) {
    // Reject IPv6 documentation, protocol-assignment and transition networks.
    const expanded = new URL('http://[' + address + ']/').hostname.slice(1, -1).toLowerCase();
    const parts = expanded.split(':');
    const second = parseInt(parts[1] || '0', 16);
    return (
      /^[23][0-9a-f]{3}:/.test(expanded) &&
      !(parts[0] === '2001' && (second < 0x200 || second === 0xdb8)) &&
      !expanded.startsWith('2002:') &&
      !expanded.startsWith('3fff:')
    );
  }
  return false;
}
export async function safeHttps(
  url: string,
  options: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    maxBytes?: number;
  } = {},
): Promise<{ status: number; body: string }> {
  const u = new URL(url);
  if (u.protocol !== 'https:' || u.username || u.password || (u.port && u.port !== '443'))
    throw new DomainError('UNSAFE_DESTINATION', 'Use a public HTTPS destination on port 443.');
  let dnsTimer: NodeJS.Timeout | undefined;
  const addresses = await Promise.race([
    lookup(u.hostname, { all: true }),
    new Promise<never>((_resolve, reject) => {
      dnsTimer = setTimeout(
        () =>
          reject(
            new DomainError('OUTBOUND_TIMEOUT', 'Destination lookup did not finish in time.', 504),
          ),
        5_000,
      );
    }),
  ]).finally(() => {
    if (dnsTimer) clearTimeout(dnsTimer);
  });
  if (!addresses.length || addresses.some((a) => !publicAddress(a.address)))
    throw new DomainError(
      'UNSAFE_DESTINATION',
      'Destination must resolve only to public addresses.',
    );
  const selected = addresses[0]!;
  return new Promise((resolve, reject) => {
    const req = request(
      u,
      {
        method: options.method ?? 'GET',
        headers: options.headers,
        lookup: (_hostname, _options, callback) =>
          callback(null, selected.address, selected.family),
        timeout: 5000,
      },
      (res) => {
        const chunks: Buffer[] = [];
        let bytes = 0;
        res.on('data', (chunk: Buffer) => {
          bytes += chunk.length;
          if (bytes > (options.maxBytes ?? 262144)) {
            req.destroy(
              new DomainError('RESPONSE_TOO_LARGE', 'Outbound response exceeded its limit.'),
            );
            return;
          }
          chunks.push(chunk);
        });
        res.on('error', reject);
        res.on('end', () =>
          resolve({ status: res.statusCode ?? 502, body: Buffer.concat(chunks).toString('utf8') }),
        );
      },
    );
    const deadline = setTimeout(
      () =>
        req.destroy(
          new DomainError(
            'OUTBOUND_TIMEOUT',
            'Destination exceeded its total response deadline.',
            504,
          ),
        ),
      10_000,
    );
    req.once('close', () => clearTimeout(deadline));
    req.on('timeout', () =>
      req.destroy(new DomainError('OUTBOUND_TIMEOUT', 'Destination did not respond in time.', 504)),
    );
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}
