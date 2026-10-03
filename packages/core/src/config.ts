import { z } from 'zod';
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  PUBLIC_ORIGIN: z.url(),
  ADMIN_ORIGIN: z.url().optional(),
  API_INTERNAL_URL: z.url().default('http://api:4000'),
  PORT: z.coerce.number().int().default(4000),
  DELIVERY_PORT: z.coerce.number().int().default(4001),
  S3_ENDPOINT: z.url(),
  S3_PUBLIC_ENDPOINT: z.url().optional(),
  S3_REGION: z.string().default('us-east-1'),
  S3_BUCKET: z.string().min(3),
  S3_ACCESS_KEY: z.string().min(1),
  S3_SECRET_KEY: z.string().min(16),
  INTERNAL_API_KEY: z.string().min(32),
  ENCRYPTION_KEY: z.string().regex(/^[a-f0-9]{64}$/),
  ENCRYPTION_KEY_ID: z
    .string()
    .regex(/^[A-Za-z0-9_-]{1,40}$/)
    .default('primary'),
  ENCRYPTION_PREVIOUS_KEYS: z.preprocess(
    (v) => (v === '' ? '{}' : v),
    z
      .string()
      .max(2000)
      .default('{}')
      .refine((value) => {
        try {
          const keys = JSON.parse(value);
          return (
            z
              .record(z.string().regex(/^[A-Za-z0-9_-]{1,40}$/), z.string().regex(/^[a-f0-9]{64}$/))
              .safeParse(keys).success && Object.keys(keys).length <= 10
          );
        } catch {
          return false;
        }
      }, 'Invalid previous encryption keys'),
  ),
  ENCRYPTION_LEGACY_KEY: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
  ),
  SMTP_HOST: z.string().min(1),
  SMTP_PORT: z.coerce.number().int().default(1025),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  SMTP_SECURE: z.enum(['true', 'false']).default('false'),
  EMAIL_FROM: z.email(),
  GITHUB_CLIENT_ID: z.string().optional(),
  GITHUB_CLIENT_SECRET: z.string().optional(),
  RP_ID: z.string().default('localhost'),
  MODERATOR_EMAILS: z.string().default(''),
  CUSTOM_DOMAIN_TARGET: z.string().max(253).optional(),
  TRUST_PROXY: z.enum(['true', 'false']).default('false'),
});
export type Config = z.infer<typeof schema>;
let current: Config | undefined;
export function config(): Config {
  if (current) return current;
  current = schema.parse(process.env);
  const origin = new URL(current.PUBLIC_ORIGIN);
  if (current.NODE_ENV === 'production' && origin.protocol !== 'https:')
    throw new Error('Production PUBLIC_ORIGIN must use HTTPS');
  if (current.NODE_ENV === 'production') {
    for (const value of [current.ADMIN_ORIGIN, current.S3_PUBLIC_ENDPOINT]) {
      if (!value || new URL(value).protocol !== 'https:')
        throw new Error('Production admin and S3 public origins must use HTTPS');
    }
    if (current.RP_ID !== origin.hostname)
      throw new Error('Production RP_ID must match the public hostname');
    if (['localhost', 'mail', '127.0.0.1'].includes(current.SMTP_HOST))
      throw new Error('Production requires a real SMTP transport');
  }
  return current;
}
