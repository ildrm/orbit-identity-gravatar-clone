import { z } from 'zod';
import { githubAccount } from './provider-request.js';
export interface ProviderProfile {
  provider: string;
  id: string;
  username: string;
  url: string;
  displayName: string;
  bio: string | null;
  avatar: string | null;
}
export interface ProviderAdapter {
  name: string;
  profile(token: string): Promise<ProviderProfile>;
}
const githubProfile = z.object({
  id: z.number().int().positive(),
  login: z.string().min(1).max(100),
  html_url: z.url().refine((v) => new URL(v).hostname === 'github.com'),
  name: z.string().nullable(),
  bio: z.string().nullable(),
  avatar_url: z.url().nullable(),
});
export function parseGitHubProfile(input: unknown): ProviderProfile {
  const p = githubProfile.parse(input);
  return {
    provider: 'github',
    id: String(p.id),
    username: p.login,
    url: p.html_url,
    displayName: p.name ?? p.login,
    bio: p.bio,
    avatar: p.avatar_url,
  };
}
export class GitHubAdapter implements ProviderAdapter {
  name = 'github';
  async profile(token: string): Promise<ProviderProfile> {
    return parseGitHubProfile(await githubAccount(token));
  }
}
