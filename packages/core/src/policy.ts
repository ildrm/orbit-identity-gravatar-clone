import type { Policy, Role, Channel } from '../../contracts/src/index.js';
export interface Viewer {
  accountId?: string;
  owner?: boolean;
  authenticated?: boolean;
  connection?: boolean;
  organization?: boolean;
  applicationId?: string;
  consentedFields?: string[];
  scopes?: string[];
}
const permissions: Record<Role, readonly string[]> = {
  OWNER: [
    'read',
    'profile',
    'members',
    'security',
    'delete',
    'applications',
    'claims',
    'organization',
  ],
  ADMIN: ['read', 'profile', 'members', 'applications', 'claims', 'organization'],
  EDITOR: ['read', 'profile', 'claims'],
  PROFILE_MANAGER: ['read', 'profile', 'claims'],
  BRAND_MANAGER: ['read', 'profile'],
  HR_MANAGER: ['read', 'organization'],
  DEVELOPER: ['read', 'applications'],
  AUDITOR: ['read'],
};
export function permitted(role: Role | undefined, permission: string): boolean {
  return !!role && permissions[role].includes(permission);
}
export function scopeForClaim(key: string): string {
  if (key.startsWith('credential:')) return 'credentials.read';
  if (key.startsWith('developer:')) return 'profile.developer';
  if (key.startsWith('professional:') || key.startsWith('org:')) return 'profile.professional';
  return 'profile.basic';
}
export function canDisclose(
  policy: Policy,
  viewer: Viewer,
  channel: Channel,
  key: string,
): boolean {
  if (viewer.owner) return true;
  if (policy.transformation === 'HIDDEN') return false;
  if (channel === 'search' && (!policy.searchable || policy.visibility !== 'PUBLIC')) return false;
  if (channel === 'index' && (!policy.indexable || policy.visibility !== 'PUBLIC')) return false;
  if (channel === 'api' && !policy.api) return false;
  if (channel === 'machine' && !policy.machine) return false;
  if (channel === 'agent' && !policy.agent) return false;
  if (viewer.applicationId) {
    if (!viewer.consentedFields?.includes(key) || !viewer.scopes?.includes(scopeForClaim(key)))
      return false;
  }
  switch (policy.visibility) {
    case 'PUBLIC':
    case 'UNLISTED':
      return true;
    case 'AUTHENTICATED':
      return !!viewer.authenticated;
    case 'CONNECTIONS':
      return !!viewer.connection;
    case 'ORGANIZATION':
      return !!viewer.organization;
    case 'SPECIFIC_APPLICATIONS':
      return !!viewer.applicationId && policy.applications.includes(viewer.applicationId);
    default:
      return false;
  }
}
export function discloseValue(policy: Policy, value: unknown): unknown {
  switch (policy.transformation) {
    case 'GENERALIZED':
    case 'ALIAS':
      return policy.disclosedValue ?? null;
    case 'REDACTED':
      return 'Redacted';
    case 'HIDDEN':
      return null;
    default:
      return value;
  }
}
export function freshness(
  claim: {
    revoked_at?: Date | string | null;
    expires_at?: Date | string | null;
    verified_at?: Date | string | null;
    verification_state: string;
  },
  now = Date.now(),
): string {
  if (claim.revoked_at) return 'Revoked';
  if (claim.expires_at && new Date(claim.expires_at).getTime() <= now) return 'Expired';
  if (claim.verified_at && now - new Date(claim.verified_at).getTime() > 90 * 86400000)
    return 'Potentially stale';
  return claim.verification_state === 'VERIFIED' ? 'Recently verified' : 'Current';
}
export const reservedHandles = new Set([
  'admin',
  'api',
  'avatar',
  'auth',
  'login',
  'register',
  'support',
  'security',
  'root',
  'www',
  'mail',
  'identity',
  'settings',
  'dashboard',
  'developer',
  'moderator',
  'null',
  'undefined',
  'help',
  'docs',
  'system',
]);
