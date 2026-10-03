import { query } from './db.js';
export async function blockedLinkHosts() {
  return new Set(
    (
      await query<{ host: string }>('SELECT host FROM blocked_link_hosts ORDER BY host LIMIT 10000')
    ).map((r) => r.host),
  );
}
export function linkAllowed(value: string, blocked: Set<string>): boolean {
  try {
    const u = new URL(value);
    if (u.protocol !== 'https:' || u.username || u.password) return false;
    const host = u.hostname.toLowerCase();
    return ![...blocked].some((b) => host === b || host.endsWith('.' + b));
  } catch {
    return false;
  }
}
export function safeClaimLinks(key: string, value: unknown, blocked: Set<string>): unknown {
  if (key === 'core:links' && Array.isArray(value))
    return value.filter(
      (v) => v && typeof v === 'object' && typeof v.url === 'string' && linkAllowed(v.url, blocked),
    );
  if (typeof value === 'string' && /^https?:\/\//i.test(value))
    return linkAllowed(value, blocked) ? value : null;
  return value;
}
