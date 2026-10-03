import { z } from 'zod';
import { safeUrlSchema, policySchema } from '../../contracts/src/index.js';
import { blockKinds } from '../../contracts/src/blocks.js';
export { blockKinds } from '../../contracts/src/blocks.js';
const item = z
  .object({
    label: z.string().min(1).max(160),
    url: safeUrlSchema,
    description: z.string().max(1000).optional(),
  })
  .strict();
export const blockConfiguration = z
  .object({
    text: z.string().max(10000).default(''),
    url: safeUrlSchema.optional(),
    items: z.array(item).max(30).default([]),
    mediaIds: z
      .array(z.string().regex(/^med_[a-f0-9]{32}$/))
      .max(30)
      .default([]),
  })
  .strict();
export const blockSchema = z
  .object({
    kind: z.enum(blockKinds),
    title: z.string().trim().min(1).max(160),
    position: z.number().int().min(0).max(1000).default(0),
    enabled: z.boolean().default(false),
    personaId: z.string().max(100).nullable().default(null),
    locale: z
      .string()
      .regex(/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/)
      .default('en'),
    configuration: blockConfiguration,
    policy: policySchema,
  })
  .strict();
