import { z } from 'zod';

export const identityTypes = [
  'PERSON',
  'ORGANIZATION',
  'TEAM',
  'PROJECT',
  'APPLICATION',
  'SERVICE',
  'BOT',
  'BRAND',
  'COMMUNITY',
] as const;
export const visibilityTypes = [
  'PUBLIC',
  'UNLISTED',
  'AUTHENTICATED',
  'CONNECTIONS',
  'ORGANIZATION',
  'SPECIFIC_APPLICATIONS',
  'PRIVATE',
] as const;
export const roleTypes = [
  'OWNER',
  'ADMIN',
  'EDITOR',
  'PROFILE_MANAGER',
  'BRAND_MANAGER',
  'HR_MANAGER',
  'DEVELOPER',
  'AUDITOR',
] as const;
export type Role = (typeof roleTypes)[number];
export type Channel = 'human' | 'api' | 'machine' | 'agent' | 'search' | 'index';
export const policySchema = z
  .object({
    visibility: z.enum(visibilityTypes).default('PRIVATE'),
    searchable: z.boolean().default(false),
    indexable: z.boolean().default(false),
    api: z.boolean().default(false),
    machine: z.boolean().default(false),
    agent: z.boolean().default(false),
    applications: z.array(z.string().max(100)).max(20).default([]),
    transformation: z.enum(['FULL', 'GENERALIZED', 'ALIAS', 'REDACTED', 'HIDDEN']).default('FULL'),
    disclosedValue: z.string().max(500).optional(),
  })
  .strict();
export type Policy = z.infer<typeof policySchema>;
export const publicPolicy: Policy = {
  visibility: 'PUBLIC',
  searchable: true,
  indexable: true,
  api: true,
  machine: true,
  agent: false,
  applications: [],
  transformation: 'FULL',
};
export const privatePolicy: Policy = {
  ...publicPolicy,
  visibility: 'PRIVATE',
  searchable: false,
  indexable: false,
  api: false,
  machine: false,
  agent: false,
};

export const emailSchema = z
  .email()
  .max(254)
  .transform((v) => v.trim().toLowerCase());
export const passwordSchema = z.string().min(12).max(128);
export const handleSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(
    /^[a-z][a-z0-9_]{2,29}$/,
    'Use 3–30 letters, numbers or underscores, starting with a letter',
  );
export const safeUrlSchema = z
  .url()
  .max(2048)
  .refine((v) => {
    try {
      const u = new URL(v);
      return u.protocol === 'https:' && !u.username && !u.password;
    } catch {
      return false;
    }
  }, 'Use a public HTTPS URL without credentials');
export const registerSchema = z
  .object({
    email: emailSchema,
    password: passwordSchema,
    locale: z.string().max(30).default('en'),
    timezone: z.string().max(100).default('UTC'),
  })
  .strict();
export const loginSchema = z
  .object({
    email: emailSchema,
    password: z.string().max(128),
    code: z.string().max(20).optional(),
  })
  .strict();
export const identitySchema = z
  .object({
    type: z.enum(identityTypes),
    handle: handleSchema,
    displayName: z.string().trim().min(1).max(120),
    visibility: z.enum(['PUBLIC', 'UNLISTED', 'PRIVATE']).default('PRIVATE'),
  })
  .strict();
export const personaSchema = z
  .object({
    name: z.string().trim().min(1).max(60),
    slug: handleSchema,
    active: z.boolean().default(true),
  })
  .strict();
export const claimKeys = [
  'core:display_name',
  'core:preferred_name',
  'core:native_name',
  'core:transliteration',
  'core:bio',
  'core:location',
  'core:website',
  'core:pronouns',
  'professional:job_title',
  'professional:employer',
  'org:department',
  'org:employment',
  'org:membership',
  'org:certification',
  'org:education',
  'org:project_role',
  'developer:github',
  'developer:languages',
  'creator:youtube',
  'core:links',
  'core:birth_date',
] as const;
export const claimValues: Record<(typeof claimKeys)[number], z.ZodType> = {
  'core:display_name': z.string().min(1).max(120),
  'core:preferred_name': z.string().min(1).max(120),
  'core:native_name': z.string().min(1).max(120),
  'core:transliteration': z.string().min(1).max(120),
  'core:bio': z.string().max(2000),
  'core:location': z.string().max(120),
  'core:website': safeUrlSchema,
  'core:pronouns': z.string().max(60),
  'professional:job_title': z.string().max(120),
  'professional:employer': z.string().max(160),
  'org:department': z.string().min(1).max(160),
  'org:employment': z.enum(['ACTIVE', 'ON_LEAVE', 'ENDED']),
  'org:membership': z.string().min(1).max(160),
  'org:certification': z.string().min(1).max(300),
  'org:education': z.string().min(1).max(300),
  'org:project_role': z.string().min(1).max(160),
  'developer:github': safeUrlSchema.refine(
    (v) => new URL(v).hostname === 'github.com',
    'Use a GitHub URL',
  ),
  'developer:languages': z.array(z.string().max(30)).max(30),
  'creator:youtube': safeUrlSchema.refine(
    (v) => ['youtube.com', 'www.youtube.com', 'youtu.be'].includes(new URL(v).hostname),
    'Use a YouTube URL',
  ),
  'core:links': z
    .array(z.object({ label: z.string().min(1).max(80), url: safeUrlSchema }).strict())
    .max(20),
  'core:birth_date': z.iso.date(),
};
export const claimSchema = z
  .object({
    key: z.enum(claimKeys),
    value: z.unknown(),
    personaId: z.string().max(100).nullable().default(null),
    locale: z
      .string()
      .regex(/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/)
      .default('en'),
    policy: policySchema,
    expiresAt: z.iso.datetime().nullable().default(null),
  })
  .strict()
  .superRefine((v, ctx) => {
    const result = claimValues[v.key].safeParse(v.value);
    if (!result.success)
      ctx.addIssue({
        code: 'custom',
        path: ['value'],
        message: result.error.issues[0]?.message ?? 'Invalid claim value',
      });
  });
export const profileSettingsSchema = z
  .object({
    visibility: z.enum(['PUBLIC', 'UNLISTED', 'PRIVATE']),
    searchable: z.boolean(),
    indexable: z.boolean(),
    machine: z.boolean(),
    agent: z.boolean(),
    contactEnabled: z.boolean().default(false),
    theme: z.enum(['light', 'dark']).default('light'),
    locale: z.string().max(30).default('en'),
  })
  .strict();
export const applicationSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    purpose: z.string().max(500),
    redirectUris: z.array(safeUrlSchema).max(10).default([]),
  })
  .strict();
export const scopes = [
  'identity.read',
  'profile.basic',
  'profile.developer',
  'profile.professional',
  'avatar.read',
  'relationships.read',
  'email.read',
  'credentials.read',
] as const;
export const consentSchema = z
  .object({
    applicationId: z.string().max(100),
    personaId: z.string().max(100).nullable().default(null),
    scopes: z.array(z.enum(scopes)).min(1).max(10),
    fields: z
      .array(z.union([z.enum(claimKeys), z.string().regex(/^credential:vcr_[a-f0-9]{32}$/)]))
      .max(30),
    expiresAt: z.iso.datetime().optional(),
  })
  .strict();
export const relationshipSchema = z
  .object({
    targetId: z.string().max(100),
    type: z.enum([
      'works_at',
      'member_of',
      'maintains',
      'created',
      'founded',
      'owns',
      'authored',
      'contributes_to',
      'represents',
      'managed_by',
      'parent_of',
      'subsidiary_of',
    ]),
    policy: policySchema,
  })
  .strict();
export const webhookSchema = z
  .object({
    url: safeUrlSchema,
    events: z
      .array(z.string().regex(/^[a-z]+\.[a-z]+$/))
      .min(1)
      .max(20),
  })
  .strict();
export interface PublicClaim {
  id: string;
  key: string;
  value: unknown;
  locale: string;
  source: string;
  verification: string;
  freshness: string;
  updatedAt: string;
  policy?: Policy;
}
export interface PublicProfile {
  id: string;
  handle: string;
  type: string;
  persona: string | null;
  displayName: string;
  claims: PublicClaim[];
  blocks?: {
    id: string;
    kind: string;
    title: string;
    locale: string;
    configuration: {
      text: string;
      url?: string;
      items: { label: string; url: string; description?: string }[];
      mediaIds?: string[];
    };
  }[];
  avatarUrl: string;
  headerUrl?: string;
  contactEnabled: boolean;
  visibility: string;
  indexable: boolean;
  machine: boolean;
  agent: boolean;
  theme: string;
  locale: string;
  revision: number;
  canonicalHandle?: string;
  canonicalUrl?: string;
}
export interface ApiError {
  code: string;
  message: string;
  status: number;
  request_id: string;
  details?: unknown;
}
