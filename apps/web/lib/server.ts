import { cookies } from 'next/headers';
import type { PublicProfile } from '../../../packages/contracts/src/index';
export async function currentAccount() {
  const c = await cookies();
  const response = await fetch(
    (process.env.API_INTERNAL_URL ?? 'http://localhost:4000') + '/api/v1/auth/me',
    { headers: { Cookie: c.toString() }, cache: 'no-store' },
  );
  if (!response.ok) return null;
  return response.json() as Promise<{
    id: string;
    email: string;
    locale: string;
    timezone: string;
    totp_enabled: boolean;
  }>;
}
export async function publicProfile(
  identifier: string,
  persona?: string,
  personalized = false,
): Promise<PublicProfile | null> {
  const url =
    (process.env.API_INTERNAL_URL ?? 'http://localhost:4000') +
    '/internal/profiles/' +
    encodeURIComponent(identifier) +
    (persona ? '?persona=' + encodeURIComponent(persona) : '');
  const response = await fetch(url, {
    headers: {
      'x-internal-api-key': process.env.INTERNAL_API_KEY ?? '',
      ...(personalized ? { Cookie: (await cookies()).toString() } : {}),
    },
    cache: 'no-store',
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error('Profile service is unavailable');
  return response.json() as Promise<PublicProfile>;
}
