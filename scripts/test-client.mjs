import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
export const origin =
  process.env.TEST_API_ORIGIN ?? process.env.PUBLIC_ORIGIN ?? 'http://localhost:8080';
export const name = 'advanced' + randomBytes(5).toString('hex');
export let checks = 0;
export function check(value, message) {
  assert.ok(value, message);
  checks++;
  process.stdout.write('PASS ' + message + '\n');
}
export class Client {
  cookie = '';
  async request(path, { method = 'GET', body, headers = {}, redirect = 'follow' } = {}) {
    const response = await fetch(origin + path, {
      method,
      redirect,
      headers: {
        Origin: process.env.PUBLIC_ORIGIN ?? origin,
        'Content-Type': 'application/json',
        ...(this.cookie ? { Cookie: this.cookie } : {}),
        ...headers,
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const cookie = response.headers.get('set-cookie');
    if (cookie) this.cookie = cookie.split(';')[0];
    const text = await response.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
    return { status: response.status, data, headers: response.headers };
  }
  async ok(path, options) {
    const r = await this.request(path, options);
    assert.ok(r.status >= 200 && r.status < 300, JSON.stringify(r));
    return r.data;
  }
}
export async function account(suffix) {
  const client = new Client(),
    email = name + suffix + '@example.test',
    password = 'Long-advanced-test-password!2026';
  await client.ok('/api/v1/auth/register', { method: 'POST', body: { email, password } });
  let token;
  for (let n = 0; n < 80 && !token; n++) {
    const list = await fetch('http://localhost:8025/api/v1/messages').then((r) => r.json());
    for (const m of list.messages.filter((m) => m.To.some((t) => t.Address === email))) {
      const detail = await fetch('http://localhost:8025/api/v1/message/' + m.ID).then((r) =>
        r.json(),
      );
      token = detail.Text.match(/token=([A-Za-z0-9_-]+)/)?.[1];
      if (token) break;
    }
    if (!token) await new Promise((r) => setTimeout(r, 250));
  }
  assert.ok(token, 'Verification mail arrived');
  await client.ok('/api/v1/auth/verify', { method: 'POST', body: { token } });
  await client.ok('/api/v1/auth/login', { method: 'POST', body: { email, password } });
  const me = await client.ok('/api/v1/auth/me');
  return {
    client,
    email,
    password,
    id: me.id,
    async proof() {
      return (await client.ok('/api/v1/auth/stepup', { method: 'POST', body: { password } })).proof;
    },
  };
}
