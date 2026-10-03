import { Input } from '../input.js';
import { Body, Controller, Inject, Param, Post, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { query, transaction } from '../../../../packages/core/src/db.js';
import { safeHttps } from '../../../../packages/core/src/outbound.js';
import { websiteProfile } from '../../../../packages/core/src/web-content.js';
import {
  claimSchema,
  privatePolicy,
  safeUrlSchema,
} from '../../../../packages/contracts/src/index.js';
import { id } from '../../../../packages/core/src/security.js';
import { event } from '../../../../packages/core/src/events.js';
import { IdentityService } from '../identity/identity.service.js';
import { DomainError } from '../../../../packages/core/src/errors.js';
import { requireAccount, type ApiRequest } from '../http.js';
const importedClaim = z
  .object({
    key: claimSchema.shape.key,
    value: z.unknown(),
    personaId: claimSchema.shape.personaId,
    locale: claimSchema.shape.locale,
    originalSource: z.string().max(100).optional(),
    originalReference: z.string().max(2048).optional(),
  })
  .strict()
  .superRefine((c, ctx) => {
    const result = claimSchema.safeParse({
      key: c.key,
      value: c.value,
      personaId: c.personaId,
      locale: c.locale,
      policy: privatePolicy,
    });
    if (!result.success)
      ctx.addIssue({ code: 'custom', path: ['value'], message: 'Invalid claim value.' });
  });
const ImportControllerpreviewInput = z
  .object({
    url: safeUrlSchema.optional(),
    bundle: z
      .object({
        manifest: z.object({ schemaVersion: z.enum(['1.0', '2.0']) }).passthrough(),
        claims: z.array(z.record(z.string(), z.unknown())).max(500),
      })
      .passthrough()
      .optional(),
  })
  .strict()
  .refine(
    (d) => Boolean(d.url) !== Boolean(d.bundle),
    'Provide a website URL or a versioned bundle',
  );
const ImportControllercommitInput = z
  .object({
    source: z.string().min(1).max(2048),
    claims: z.array(importedClaim).min(1).max(100),
  })
  .strict();
@ApiTags('Validated private imports')
@Controller('api/v1/identities/:id/imports')
export class ImportController {
  constructor(@Inject(IdentityService) private readonly identities: IdentityService) {}
  @Input(ImportControllerpreviewInput)
  @Post('preview')
  async preview(@Param('id') identityId: string, @Body() b: unknown, @Req() r: ApiRequest) {
    await this.identities.authorize(requireAccount(r).id, identityId, 'security');
    const d = ImportControllerpreviewInput.parse(b);
    let candidates: { key: string; value: unknown; locale?: string; originalSource?: string }[] =
      [];
    if (d.url) {
      const result = await safeHttps(d.url, { maxBytes: 256000, headers: { Accept: 'text/html' } });
      if (result.status !== 200)
        throw new DomainError('IMPORT_SOURCE_UNAVAILABLE', 'Public website unavailable.');
      candidates = websiteProfile(result.body).flatMap((c) => {
        const object =
          c['@type'] === 'ProfilePage' && c.mainEntity && typeof c.mainEntity === 'object'
            ? (c.mainEntity as Record<string, unknown>)
            : c;
        return [
          ['name', 'core:display_name'],
          ['description', 'core:bio'],
          ['url', 'core:website'],
          ['jobTitle', 'professional:job_title'],
        ].flatMap(([property, key]) =>
          typeof object[property!] === 'string'
            ? [{ key: key!, value: object[property!], originalSource: 'PUBLIC_WEBSITE' }]
            : [],
        );
      });
    } else
      candidates = d
        .bundle!.claims.filter((c) => c.selected !== false && c.revoked_at == null)
        .map((c) => ({
          key: String(c.key),
          value: c.value,
          locale: String(c.locale ?? 'en'),
          originalSource: String(c.source ?? 'EXTERNAL_IMPORT'),
        }));
    const claims = candidates.slice(0, 100).flatMap((c) => {
      const parsed = importedClaim.safeParse({ ...c, personaId: null });
      return parsed.success ? [parsed.data] : [];
    });
    return {
      source: d.url ?? 'orbit-bundle',
      claims,
      message:
        'Review the proposed claims. Imports are private, unverified copies; existing authoritative claims win conflicts. Media must pass the ordinary signed upload validation.',
    };
  }
  @Input(ImportControllercommitInput)
  @Post()
  async commit(@Param('id') identityId: string, @Body() b: unknown, @Req() r: ApiRequest) {
    const d = ImportControllercommitInput.parse(b),
      accountId = requireAccount(r).id,
      importId = id('imp');
    let conflicts = 0;
    await transaction(async (db) => {
      await this.identities.authorize(accountId, identityId, 'security', db);
      await this.identities.snapshot(db, identityId, accountId);
      for (const claim of d.claims) {
        if (
          claim.personaId &&
          !(
            await query(
              'SELECT 1 FROM personas WHERE id=$1 AND identity_id=$2 AND active',
              [claim.personaId, identityId],
              db,
            )
          ).length
        )
          throw new DomainError(
            'INVALID_PERSONA',
            'Import persona does not belong to this identity.',
          );
        const conflict =
          (
            await query(
              'SELECT 1 FROM claims WHERE identity_id=$1 AND key=$2 AND persona_id IS NOT DISTINCT FROM $3 AND locale=$4 AND selected AND revoked_at IS NULL',
              [identityId, claim.key, claim.personaId, claim.locale],
              db,
            )
          ).length > 0;
        if (conflict) conflicts++;
        await query(
          "INSERT INTO claims(id,identity_id,key,value,persona_id,locale,policy,source,source_reference,actor_id,selected,metadata) VALUES($1,$2,$3,$4,$5,$6,$7,'EXTERNAL_IMPORT',$8,$9,$10,$11)",
          [
            id('clm'),
            identityId,
            claim.key,
            JSON.stringify(claim.value),
            claim.personaId,
            claim.locale,
            JSON.stringify(privatePolicy),
            d.source,
            accountId,
            !conflict,
            JSON.stringify({
              importId,
              originalSource: claim.originalSource ?? null,
              originalReference: claim.originalReference ?? null,
              verificationInherited: false,
            }),
          ],
          db,
        );
      }
      await query(
        'INSERT INTO imports(id,identity_id,account_id,source,imported_claims) VALUES($1,$2,$3,$4,$5)',
        [importId, identityId, accountId, d.source, d.claims.length],
        db,
      );
      await event(db, identityId, accountId, 'profile.imported', r.requestId, {
        importId,
        claims: d.claims.length,
        conflicts,
      });
    });
    return {
      id: importId,
      imported: d.claims.length,
      conflicts,
      message:
        'Imported privately. Select conflicts and publish deliberately from the claims editor.',
    };
  }
}
