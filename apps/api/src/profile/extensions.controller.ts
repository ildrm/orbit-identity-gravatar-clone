import { Input } from '../input.js';
import { Body, Controller, Delete, Get, Inject, Param, Post, Put, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { query, transaction } from '../../../../packages/core/src/db.js';
import { id } from '../../../../packages/core/src/security.js';
import { event, audit } from '../../../../packages/core/src/events.js';
import { config } from '../../../../packages/core/src/config.js';
import { policySchema, safeUrlSchema } from '../../../../packages/contracts/src/index.js';
import { DomainError, requireValue } from '../../../../packages/core/src/errors.js';
import { IdentityService } from '../identity/identity.service.js';
import { requireAccount, type ApiRequest } from '../http.js';
const schema = z
  .object({
    key: z.string().regex(/^x-[a-z0-9-]{3,40}:[a-z0-9_]{1,40}$/),
    version: z.number().int().min(1).max(1000),
    type: z.enum(['text', 'number', 'boolean', 'https_url', 'text_array']),
    title: z.string().min(1).max(120),
    description: z.string().min(20).max(2000),
    maxLength: z.number().int().min(1).max(2000).default(200),
    localized: z.boolean().default(false),
    indexable: z.boolean().default(false),
  })
  .strict();
interface Definition {
  key: string;
  version: number;
  type: string;
  max_length: number;
  localized: boolean;
  indexable: boolean;
  revoked_at: Date | null;
}
function operator(r: ApiRequest) {
  const a = requireAccount(r);
  if (
    !config()
      .MODERATOR_EMAILS.split(',')
      .map((s) => s.trim().toLowerCase())
      .includes(a.email)
  )
    throw new DomainError('FORBIDDEN', 'Schema operator access required.', 403);
  return a;
}
const ExtensionsControllerregisterInput = schema;
const ExtensionsControllervalueInput = z
  .object({
    key: schema.shape.key,
    value: z.unknown(),
    locale: z
      .string()
      .regex(/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/)
      .default('en'),
    personaId: z.string().max(100).nullable().default(null),
    policy: policySchema,
  })
  .strict();
@ApiTags('Declarative schema extensions')
@Controller('api/v1')
export class ExtensionsController {
  constructor(@Inject(IdentityService) private readonly identities: IdentityService) {}
  @Get('schemas') schemas() {
    return query(
      'SELECT key,version,type,title,description,max_length,localized,indexable FROM schema_definitions WHERE revoked_at IS NULL ORDER BY key',
    );
  }
  @Input(ExtensionsControllerregisterInput)
  @Post('admin/schemas')
  async register(@Body() b: unknown, @Req() r: ApiRequest) {
    const a = operator(r),
      d = ExtensionsControllerregisterInput.parse(b);
    await transaction(async (db) => {
      await query('SELECT pg_advisory_xact_lock(718210)', [], db);
      if (
        !(await query('SELECT 1 FROM schema_definitions WHERE key=$1', [d.key], db)).length &&
        (await query('SELECT 1 FROM schema_definitions OFFSET 499 LIMIT 1', [], db)).length
      )
        throw new DomainError('SCHEMA_LIMIT', 'The operator schema limit has been reached.');
      const existing = (
        await query<Definition>(
          'SELECT * FROM schema_definitions WHERE key=$1 FOR UPDATE',
          [d.key],
          db,
        )
      )[0];
      if (
        existing &&
        (existing.type !== d.type ||
          d.version <= existing.version ||
          existing.max_length > d.maxLength ||
          (existing.localized && !d.localized))
      )
        throw new DomainError(
          'INCOMPATIBLE_SCHEMA',
          'Updates must keep the type, increase version and preserve accepted value bounds/localization.',
          409,
        );
      await query(
        'INSERT INTO schema_definitions(key,version,type,title,description,max_length,localized,indexable,registered_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(key) DO UPDATE SET version=EXCLUDED.version,title=EXCLUDED.title,description=EXCLUDED.description,max_length=EXCLUDED.max_length,localized=EXCLUDED.localized,indexable=EXCLUDED.indexable,revoked_at=NULL',
        [
          d.key,
          d.version,
          d.type,
          d.title,
          d.description,
          d.maxLength,
          d.localized,
          d.indexable,
          a.id,
        ],
        db,
      );
      if (!d.indexable)
        await query(
          "UPDATE claims SET policy=jsonb_set(jsonb_set(policy,'{indexable}','false'),'{searchable}','false') WHERE key=$1",
          [d.key],
          db,
        );
      await audit(db, a.id, null, 'schema.registered', r.requestId, {
        key: d.key,
        version: d.version,
      });
    });
    return {
      message:
        'Declarative schema registered. Values are validated; no third-party code is executed.',
    };
  }
  @Delete('admin/schemas/:key') async revoke(@Param('key') key: string, @Req() r: ApiRequest) {
    const a = operator(r);
    await transaction(async (db) => {
      await query('UPDATE schema_definitions SET revoked_at=now() WHERE key=$1', [key], db);
      await query('UPDATE claims SET selected=false,revoked_at=now() WHERE key=$1', [key], db);
      await audit(db, a.id, null, 'schema.revoked', r.requestId, { key });
    });
    return { message: 'Schema and its published claims revoked.' };
  }
  @Input(ExtensionsControllervalueInput)
  @Put('identities/:id/extensions')
  async value(@Param('id') identityId: string, @Body() b: unknown, @Req() r: ApiRequest) {
    const d = ExtensionsControllervalueInput.parse(b),
      accountId = requireAccount(r).id,
      claimId = id('clm');
    await transaction(async (db) => {
      await this.identities.authorize(accountId, identityId, 'claims', db);
      const definition = requireValue(
        (
          await query<Definition>(
            'SELECT * FROM schema_definitions WHERE key=$1 AND revoked_at IS NULL FOR SHARE',
            [d.key],
            db,
          )
        )[0],
        'Registered schema unavailable',
      );
      const validator =
        definition.type === 'text'
          ? z.string().max(definition.max_length)
          : definition.type === 'number'
            ? z.number().finite()
            : definition.type === 'boolean'
              ? z.boolean()
              : definition.type === 'https_url'
                ? safeUrlSchema
                : z.array(z.string().max(definition.max_length)).max(30);
      if (!validator.safeParse(d.value).success)
        throw new DomainError(
          'SCHEMA_VALUE_INVALID',
          'Value does not satisfy the registered schema.',
        );
      if (!definition.localized && d.locale !== 'en')
        throw new DomainError('SCHEMA_NOT_LOCALIZED', 'This schema uses the base locale.');
      if (!definition.indexable && (d.policy.indexable || d.policy.searchable))
        throw new DomainError('SCHEMA_NOT_INDEXABLE', 'This schema forbids indexing and search.');
      if (d.personaId)
        requireValue(
          (
            await query(
              'SELECT 1 FROM personas WHERE id=$1 AND identity_id=$2 AND active',
              [d.personaId, identityId],
              db,
            )
          )[0],
          'Persona unavailable',
        );
      await this.identities.snapshot(db, identityId, accountId);
      await query(
        'UPDATE claims SET selected=false WHERE identity_id=$1 AND key=$2 AND persona_id IS NOT DISTINCT FROM $3 AND locale=$4',
        [identityId, d.key, d.personaId, d.locale],
        db,
      );
      await query(
        'INSERT INTO claims(id,identity_id,key,value,locale,persona_id,policy,actor_id,metadata) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
        [
          claimId,
          identityId,
          d.key,
          JSON.stringify(d.value),
          d.locale,
          d.personaId,
          JSON.stringify(d.policy),
          accountId,
          JSON.stringify({ schemaVersion: definition.version }),
        ],
        db,
      );
      await event(db, identityId, accountId, 'claim.updated', r.requestId, { claimId, key: d.key });
    });
    return { id: claimId };
  }
}
