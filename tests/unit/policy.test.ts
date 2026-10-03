import { describe, it, expect } from 'vitest';
import {
  canDisclose,
  discloseValue,
  permitted,
  freshness,
} from '../../packages/core/src/policy.js';
import {
  publicPolicy,
  privatePolicy,
  roleTypes,
  claimSchema,
  safeUrlSchema,
} from '../../packages/contracts/src/index.js';
describe('policy and authorization', () => {
  it.each(['human', 'api', 'machine', 'agent', 'search', 'index'] as const)(
    'private data is denied on %s',
    (channel) => {
      expect(canDisclose(privatePolicy, {}, channel, 'core:bio')).toBe(false);
      expect(canDisclose(privatePolicy, { owner: true }, channel, 'core:bio')).toBe(true);
    },
  );
  it('separates channel policy from public visibility', () => {
    expect(canDisclose({ ...publicPolicy, api: false }, {}, 'api', 'core:bio')).toBe(false);
    expect(canDisclose({ ...publicPolicy, machine: false }, {}, 'machine', 'core:bio')).toBe(false);
    expect(canDisclose(publicPolicy, {}, 'agent', 'core:bio')).toBe(false);
  });
  it('does not index unlisted fields', () => {
    expect(canDisclose({ ...publicPolicy, visibility: 'UNLISTED' }, {}, 'search', 'core:bio')).toBe(
      false,
    );
  });
  it('requires scope, field, app and visibility together', () => {
    const policy = {
      ...publicPolicy,
      visibility: 'SPECIFIC_APPLICATIONS' as const,
      applications: ['app_a'],
    };
    const viewer = {
      applicationId: 'app_a',
      consentedFields: ['professional:employer'],
      scopes: ['profile.professional'],
    };
    expect(canDisclose(policy, viewer, 'api', 'professional:employer')).toBe(true);
    expect(
      canDisclose(policy, { ...viewer, applicationId: 'app_b' }, 'api', 'professional:employer'),
    ).toBe(false);
    expect(
      canDisclose(policy, { ...viewer, scopes: ['profile.basic'] }, 'api', 'professional:employer'),
    ).toBe(false);
    expect(
      canDisclose(policy, { ...viewer, consentedFields: [] }, 'api', 'professional:employer'),
    ).toBe(false);
  });
  it('requires relationship context for connection and organization policies', () => {
    for (const visibility of ['CONNECTIONS', 'ORGANIZATION'] as const) {
      expect(
        canDisclose({ ...publicPolicy, visibility }, { authenticated: true }, 'human', 'core:bio'),
      ).toBe(false);
    }
    expect(
      canDisclose(
        { ...publicPolicy, visibility: 'CONNECTIONS' },
        { connection: true },
        'human',
        'core:bio',
      ),
    ).toBe(true);
  });
  it('generalization does not return the private source value', () => {
    expect(
      discloseValue(
        { ...publicPolicy, transformation: 'GENERALIZED', disclosedValue: 'Azerbaijan' },
        'Baku, Azerbaijan',
      ),
    ).toBe('Azerbaijan');
    expect(discloseValue({ ...publicPolicy, transformation: 'HIDDEN' }, 'secret')).toBeNull();
  });
  it.each(roleTypes)('deletion is restricted for %s', (role) => {
    expect(permitted(role, 'delete')).toBe(role === 'OWNER');
    expect(permitted(role, 'not-a-permission')).toBe(false);
  });
  it('does not present expired or revoked verification as current', () => {
    expect(freshness({ verification_state: 'VERIFIED', expires_at: '2000-01-01' })).toBe('Expired');
    expect(freshness({ verification_state: 'VERIFIED', revoked_at: '2000-01-01' })).toBe('Revoked');
  });
  it('rejects unexpected or unsafe claim data', () => {
    expect(
      claimSchema.safeParse({
        key: 'core:bio',
        value: 'hi',
        policy: publicPolicy,
        verification_state: 'VERIFIED',
      }).success,
    ).toBe(false);
    expect(
      claimSchema.safeParse({ key: 'unknown:data', value: 'hi', policy: publicPolicy }).success,
    ).toBe(false);
    expect(safeUrlSchema.safeParse('javascript:alert(1)').success).toBe(false);
    expect(safeUrlSchema.safeParse('https://user:pass@example.com').success).toBe(false);
  });
});
