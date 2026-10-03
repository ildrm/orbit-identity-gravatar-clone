import { describe, it, expect } from 'vitest';
import { parseGitHubProfile } from '../../packages/core/src/providers.js';
describe('provider provenance boundary', () => {
  it('maps immutable provider ID without treating bio as verification', () => {
    const p = parseGitHubProfile({
      id: 42,
      login: 'alice',
      html_url: 'https://github.com/alice',
      name: null,
      bio: 'A bio',
      avatar_url: 'https://avatars.githubusercontent.com/u/42',
    });
    expect(p.id).toBe('42');
    expect(p.displayName).toBe('alice');
    expect(p.provider).toBe('github');
  });
  it('rejects forged provider locations', () => {
    expect(() =>
      parseGitHubProfile({
        id: 42,
        login: 'alice',
        html_url: 'https://attacker.example/alice',
        name: null,
        bio: null,
        avatar_url: null,
      }),
    ).toThrow();
  });
});
