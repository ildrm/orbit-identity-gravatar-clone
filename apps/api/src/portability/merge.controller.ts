import { Input } from '../input.js';
import { Body, Controller, Get, Inject, Param, Post, Query, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { query, transaction } from '../../../../packages/core/src/db.js';
import { id, secret, digest } from '../../../../packages/core/src/security.js';
import { audit, event } from '../../../../packages/core/src/events.js';
import { DomainError, requireValue } from '../../../../packages/core/src/errors.js';
import { privatePolicy } from '../../../../packages/contracts/src/index.js';
import { IdentityService } from '../identity/identity.service.js';
import { AuthService } from '../auth/auth.service.js';
import { requireAccount, type ApiRequest } from '../http.js';
const MergeControllermergeInput = z
  .object({
    targetId: z.string().regex(/^idn_[a-f0-9]{32}$/),
    sourceConfirmation: z.string().max(30),
    targetConfirmation: z.string().max(30),
    proof: z.string().max(200),
  })
  .strict();
const MergeControllerticketInput = z
  .object({ targetEmail: z.email().max(254), proof: z.string().max(200) })
  .strict();
const MergeControllermergeAccountInput = z
  .object({
    ticket: z.string().max(200),
    proof: z.string().max(200),
    confirmation: z.literal('MERGE ACCOUNTS'),
  })
  .strict();
@ApiTags('Merging')
@Controller('api/v1')
export class MergeController {
  constructor(
    @Inject(IdentityService) private readonly identities: IdentityService,
    @Inject(AuthService) private readonly auth: AuthService,
  ) {}
  @Get('identities/:id/merge-preview') async preview(
    @Param('id') sourceId: string,
    @Query('target') targetId: string,
    @Req() r: ApiRequest,
  ) {
    const accountId = requireAccount(r).id;
    const source = await this.identities.authorize(accountId, sourceId, 'security'),
      target = await this.identities.authorize(accountId, targetId, 'security');
    if (
      source.id === target.id ||
      source.type !== target.type ||
      source.state !== 'ACTIVE' ||
      target.state !== 'ACTIVE'
    )
      throw new DomainError(
        'INVALID_MERGE',
        'Choose two different active identities of the same type.',
      );
    const claims = await query(
      'SELECT id,key,persona_id,locale,source,verification_state,policy,selected FROM claims WHERE identity_id=$1 AND revoked_at IS NULL ORDER BY key,id',
      [sourceId],
    );
    const conflicts = await query(
      'SELECT s.id AS source_claim_id,t.id AS target_claim_id,s.key,s.locale FROM claims s JOIN claims t ON t.identity_id=$2 AND t.key=s.key AND t.locale=s.locale AND t.persona_id IS NULL AND t.selected AND t.revoked_at IS NULL WHERE s.identity_id=$1 AND s.persona_id IS NULL AND s.selected AND s.revoked_at IS NULL',
      [sourceId, targetId],
    );
    return {
      source: { id: source.id, handle: source.handle },
      target: { id: target.id, handle: target.handle },
      claims,
      conflicts,
      effects: [
        'Keep the target handle and resolve the old ID and handles to it.',
        'Keep target claims selected when values conflict.',
        'Preserve source claim provenance and archived history.',
        'Use the more private profile settings.',
        'Revoke application grants and domain routing; reconnect and grant access explicitly.',
        'Require relationship reconfirmation and retain only the target management team.',
      ],
    };
  }
  @Input(MergeControllermergeInput)
  @Post('identities/:id/merge')
  async merge(@Param('id') sourceId: string, @Body() b: unknown, @Req() r: ApiRequest) {
    const d = MergeControllermergeInput.parse(b);
    const accountId = requireAccount(r).id;
    await this.auth.requireStepUp(accountId, d.proof);
    if (sourceId === d.targetId)
      throw new DomainError('INVALID_MERGE', 'An identity cannot be merged into itself.');
    const mergeId = id('mrg');
    await transaction(async (db) => {
      await query(
        'SELECT id FROM identities WHERE id=ANY($1::text[]) ORDER BY id FOR UPDATE',
        [[sourceId, d.targetId]],
        db,
      );
      const source = await this.identities.authorize(accountId, sourceId, 'security', db),
        target = await this.identities.authorize(accountId, d.targetId, 'security', db);
      if (
        source.type !== target.type ||
        source.state !== 'ACTIVE' ||
        target.state !== 'ACTIVE' ||
        source.handle !== d.sourceConfirmation ||
        target.handle !== d.targetConfirmation
      )
        throw new DomainError(
          'INVALID_MERGE',
          'Confirm both handles and choose active identities of the same type.',
        );
      await this.identities.snapshot(db, sourceId, accountId);
      await this.identities.snapshot(db, d.targetId, accountId);
      const sourceSnapshot = (
        await query<{ snapshot: unknown }>(
          'SELECT snapshot FROM revisions WHERE identity_id=$1 ORDER BY revision DESC LIMIT 1',
          [sourceId],
          db,
        )
      )[0]!.snapshot;
      const targetSnapshot = (
        await query<{ snapshot: unknown }>(
          'SELECT snapshot FROM revisions WHERE identity_id=$1 ORDER BY revision DESC LIMIT 1',
          [d.targetId],
          db,
        )
      )[0]!.snapshot;
      await query(
        'INSERT INTO identity_merges(id,source_id,target_id,actor_id,source_snapshot,target_snapshot) VALUES($1,$2,$3,$4,$5,$6)',
        [
          mergeId,
          sourceId,
          d.targetId,
          accountId,
          JSON.stringify(sourceSnapshot),
          JSON.stringify(targetSnapshot),
        ],
        db,
      );
      const personas = await query<{ id: string; slug: string }>(
        'SELECT id,slug FROM personas WHERE identity_id=$1 ORDER BY id',
        [sourceId],
        db,
      );
      for (const p of personas) {
        await query(
          'INSERT INTO merge_persona_aliases(source_id,slug,target_persona_id) VALUES($1,$2,$3)',
          [sourceId, p.slug, p.id],
          db,
        );
        const collision = (
          await query(
            'SELECT 1 FROM personas WHERE identity_id=$1 AND slug=$2',
            [d.targetId, p.slug],
            db,
          )
        ).length;
        await query(
          'UPDATE personas SET identity_id=$1,slug=$2 WHERE id=$3',
          [d.targetId, collision ? p.slug.slice(0, 18) + '_' + p.id.slice(-10) : p.slug, p.id],
          db,
        );
      }
      await query(
        "UPDATE claims SET metadata=metadata||jsonb_build_object('mergedFrom',$1,'selectedBeforeMerge',selected) WHERE identity_id=$1",
        [sourceId],
        db,
      );
      await query(
        'UPDATE claims s SET selected=false WHERE s.identity_id=$1 AND s.selected AND s.persona_id IS NULL AND EXISTS(SELECT 1 FROM claims t WHERE t.identity_id=$2 AND t.key=s.key AND t.locale=s.locale AND t.persona_id IS NULL AND t.selected AND t.revoked_at IS NULL)',
        [sourceId, d.targetId],
        db,
      );
      if (source.visibility === 'PRIVATE')
        await query(
          'UPDATE claims SET policy=$2 WHERE identity_id=$1',
          [sourceId, JSON.stringify(privatePolicy)],
          db,
        );
      await query(
        'UPDATE claims SET identity_id=$2 WHERE identity_id=$1',
        [sourceId, d.targetId],
        db,
      );
      await query(
        "UPDATE signing_keys SET state='REVOKED',revoked_at=now(),private_encrypted='' WHERE identity_id=$1",
        [sourceId],
        db,
      );
      await query(
        'UPDATE credentials SET revoked_at=now() WHERE subject_id=$1 OR issuer_id=$1',
        [sourceId],
        db,
      );
      await query(
        "UPDATE did_associations SET revoked_at=now(),proof='' WHERE identity_id=$1",
        [sourceId],
        db,
      );
      await query(
        "UPDATE web_proofs SET revoked_at=now(),status='REVOKED' WHERE identity_id=$1",
        [sourceId],
        db,
      );
      await query('DELETE FROM analytics_daily WHERE identity_id=$1', [sourceId], db);
      await query('DELETE FROM contact_messages WHERE identity_id=$1', [sourceId], db);
      await query(
        'UPDATE legacy_policies SET revoked_at=now() WHERE identity_id=ANY($1::text[])',
        [[sourceId, d.targetId]],
        db,
      );
      await query(
        "UPDATE legacy_requests SET state='VETOED',evidence_encrypted='' WHERE identity_id=ANY($1::text[]) AND state IN ('PENDING','APPROVED')",
        [[sourceId, d.targetId]],
        db,
      );
      await query(
        'UPDATE profile_blocks SET identity_id=$2,policy=$3 WHERE identity_id=$1',
        [sourceId, d.targetId, JSON.stringify(privatePolicy)],
        db,
      );
      await query('DELETE FROM avatar_selections WHERE identity_id=$1', [source.id], db);
      await query(
        'UPDATE media SET identity_id=$2,public_enabled=false WHERE identity_id=$1',
        [sourceId, d.targetId],
        db,
      );
      await query(
        'UPDATE consents SET revoked_at=now() WHERE identity_id=ANY($1::text[])',
        [[sourceId, d.targetId]],
        db,
      );
      await query(
        'UPDATE consents SET identity_id=$2 WHERE identity_id=$1',
        [sourceId, d.targetId],
        db,
      );
      await query(
        'UPDATE qr_codes SET identity_id=$2 WHERE identity_id=$1',
        [sourceId, d.targetId],
        db,
      );
      await query(
        'UPDATE domains SET revoked_at=now() WHERE identity_id=ANY($1::text[])',
        [[sourceId, d.targetId]],
        db,
      );
      await query(
        'UPDATE domains SET identity_id=$2 WHERE identity_id=$1',
        [sourceId, d.targetId],
        db,
      );
      await query(
        'UPDATE enterprise_assertions SET subject_id=$2 WHERE subject_id=$1',
        [sourceId, d.targetId],
        db,
      );
      const relationships = await query<{
        id: string;
        source_id: string;
        target_id: string;
        type: string;
      }>(
        'SELECT * FROM relationships WHERE source_id=$1 OR target_id=$1 ORDER BY id FOR UPDATE',
        [sourceId],
        db,
      );
      for (const rel of relationships) {
        const from = rel.source_id === sourceId ? d.targetId : rel.source_id,
          to = rel.target_id === sourceId ? d.targetId : rel.target_id;
        const collision =
          from === to ||
          (
            await query(
              'SELECT 1 FROM relationships WHERE source_id=$1 AND target_id=$2 AND type=$3',
              [from, to, rel.type],
              db,
            )
          ).length > 0;
        if (collision)
          await query('UPDATE relationships SET revoked_at=now() WHERE id=$1', [rel.id], db);
        else
          await query(
            "UPDATE relationships SET source_id=$1,target_id=$2,verification_state='UNILATERAL',confirmed_at=NULL WHERE id=$3",
            [from, to, rel.id],
            db,
          );
      }
      await query(
        "UPDATE provider_connections SET revoked_at=now(),token_encrypted='' WHERE identity_id=ANY($1::text[])",
        [[sourceId, d.targetId]],
        db,
      );
      const visibility =
        source.visibility === 'PRIVATE' || target.visibility === 'PRIVATE'
          ? 'PRIVATE'
          : source.visibility === 'UNLISTED' || target.visibility === 'UNLISTED'
            ? 'UNLISTED'
            : 'PUBLIC';
      await query(
        'UPDATE identities SET visibility=$2,searchable=searchable AND $3,indexable=indexable AND $4,machine=machine AND $5,agent=agent AND $6,contact_enabled=false,avatar_media_id=COALESCE(avatar_media_id,$7) WHERE id=$1',
        [
          d.targetId,
          visibility,
          source.searchable,
          source.indexable,
          source.machine,
          source.agent,
          source.avatar_media_id,
        ],
        db,
      );
      await query(
        "UPDATE identities SET state='MERGED',merged_into=$2,avatar_media_id=NULL,header_media_id=NULL,visibility='PRIVATE',searchable=false,indexable=false,machine=false,agent=false,contact_enabled=false,updated_at=now() WHERE id=$1",
        [sourceId, d.targetId],
        db,
      );
      await query('DELETE FROM memberships WHERE identity_id=$1', [sourceId], db);
      await event(db, sourceId, accountId, 'identity.merged', r.requestId, {
        mergeId,
        targetId: d.targetId,
      });
      await event(db, d.targetId, accountId, 'identity.merged', r.requestId, { mergeId, sourceId });
    });
    return {
      id: mergeId,
      targetId: d.targetId,
      message:
        'Merge completed. Review private claims and create new application grants before publishing.',
    };
  }
  @Input(MergeControllerticketInput)
  @Post('auth/merge-ticket')
  async ticket(@Body() b: unknown, @Req() r: ApiRequest) {
    const d = MergeControllerticketInput.parse(b),
      account = requireAccount(r);
    await this.auth.requireStepUp(account.id, d.proof);
    if (account.email === d.targetEmail.toLowerCase())
      throw new DomainError('INVALID_MERGE', 'Choose a different account.');
    const token = secret();
    await transaction(async (db) => {
      await query(
        "INSERT INTO challenges(id,account_id,kind,digest,data,expires_at) VALUES($1,$2,'ACCOUNT_MERGE',$3,$4,now()+interval '10 minutes')",
        [
          id('chl'),
          account.id,
          digest(token),
          JSON.stringify({ targetEmail: d.targetEmail.toLowerCase() }),
        ],
        db,
      );
      await audit(db, account.id, null, 'account.merge_proof_created', r.requestId);
    });
    return {
      ticket: token,
      expiresIn: 600,
      message: 'Sign into the destination account and confirm with its password and security code.',
    };
  }
  @Input(MergeControllermergeAccountInput)
  @Post('auth/merge')
  async mergeAccount(@Body() b: unknown, @Req() r: ApiRequest) {
    const d = MergeControllermergeAccountInput.parse(b),
      account = requireAccount(r);
    await this.auth.requireStepUp(account.id, d.proof);
    await transaction(async (db) => {
      const candidate = requireValue(
        (
          await query<{ account_id: string }>(
            "SELECT account_id FROM challenges WHERE digest=$1 AND kind='ACCOUNT_MERGE' AND used_at IS NULL AND expires_at>now()",
            [digest(d.ticket)],
            db,
          )
        )[0],
        'Merge proof unavailable',
      );
      if (candidate.account_id === account.id)
        throw new DomainError('INVALID_MERGE', 'Choose a different account.');
      const accounts = await query<{
        id: string;
        state: string;
        email: string;
        verified_at: Date | null;
      }>(
        'SELECT id,state,email,verified_at FROM accounts WHERE id=ANY($1::text[]) ORDER BY id FOR UPDATE',
        [[candidate.account_id, account.id]],
        db,
      );
      if (accounts.length !== 2 || accounts.some((a) => a.state !== 'ACTIVE' || !a.verified_at))
        throw new DomainError('INVALID_MERGE', 'Both accounts must be active and verified.');
      const proof = requireValue(
        (
          await query<{ data: { targetEmail: string } }>(
            "UPDATE challenges SET used_at=now() WHERE digest=$1 AND kind='ACCOUNT_MERGE' AND account_id=$2 AND used_at IS NULL AND expires_at>now() RETURNING data",
            [digest(d.ticket), candidate.account_id],
            db,
          )
        )[0],
        'Merge proof unavailable',
      );
      if (proof.data.targetEmail !== account.email)
        throw new DomainError(
          'INVALID_MERGE',
          'The proof names a different destination account.',
          403,
        );
      await query(
        'SELECT id FROM identities WHERE id IN (SELECT identity_id FROM memberships WHERE account_id=ANY($1::text[])) ORDER BY id FOR UPDATE',
        [[candidate.account_id, account.id]],
        db,
      );
      const sourceMemberships = await query<{ identity_id: string; role: string }>(
        'SELECT identity_id,role FROM memberships WHERE account_id=$1 ORDER BY identity_id',
        [candidate.account_id],
        db,
      );
      const rank = [
        'AUDITOR',
        'DEVELOPER',
        'HR_MANAGER',
        'BRAND_MANAGER',
        'PROFILE_MANAGER',
        'EDITOR',
        'ADMIN',
        'OWNER',
      ];
      for (const m of sourceMemberships) {
        const existing = (
          await query<{ role: string }>(
            'SELECT role FROM memberships WHERE identity_id=$1 AND account_id=$2',
            [m.identity_id, account.id],
            db,
          )
        )[0];
        if (
          existing &&
          existing.role !== m.role &&
          !['OWNER', 'ADMIN'].includes(m.role) &&
          !['OWNER', 'ADMIN'].includes(existing.role)
        )
          throw new DomainError(
            'ROLE_CONFLICT',
            'Resolve different delegated roles on a shared identity before merging.',
            409,
          );
        const role =
          existing && rank.indexOf(existing.role) > rank.indexOf(m.role) ? existing.role : m.role;
        await query(
          'INSERT INTO memberships(identity_id,account_id,role) VALUES($1,$2,$3) ON CONFLICT(identity_id,account_id) DO UPDATE SET role=EXCLUDED.role',
          [m.identity_id, account.id, role],
          db,
        );
        await event(db, m.identity_id, account.id, 'account.merged', r.requestId, {
          sourceAccountId: candidate.account_id,
        });
      }
      await query('DELETE FROM memberships WHERE account_id=$1', [candidate.account_id], db);
      await query(
        'UPDATE applications SET account_id=$2 WHERE account_id=$1',
        [candidate.account_id, account.id],
        db,
      );
      await query(
        'UPDATE consents SET revoked_at=now() WHERE account_id=ANY($1::text[])',
        [[candidate.account_id, account.id]],
        db,
      );
      await query(
        'UPDATE consents SET account_id=$2 WHERE account_id=$1',
        [candidate.account_id, account.id],
        db,
      );
      await query(
        'UPDATE provider_connections SET actor_id=$2 WHERE actor_id=$1',
        [candidate.account_id, account.id],
        db,
      );
      await query(
        'UPDATE sessions SET revoked_at=now() WHERE account_id=ANY($1::text[])',
        [[candidate.account_id, account.id]],
        db,
      );
      await query('DELETE FROM notifications WHERE account_id=$1', [candidate.account_id], db);
      await query(
        'DELETE FROM notification_preferences WHERE account_id=$1',
        [candidate.account_id],
        db,
      );
      await query(
        'UPDATE legacy_policies SET revoked_at=now() WHERE owner_id=$1 OR custodian_id=$1',
        [candidate.account_id],
        db,
      );
      await query(
        "UPDATE legacy_requests SET state='VETOED',evidence_encrypted='' WHERE state IN ('PENDING','APPROVED') AND (requester_id=$1 OR identity_id IN (SELECT identity_id FROM legacy_policies WHERE owner_id=$1 OR custodian_id=$1))",
        [candidate.account_id],
        db,
      );
      await query('DELETE FROM passkeys WHERE account_id=$1', [candidate.account_id], db);
      await query('DELETE FROM backup_codes WHERE account_id=$1', [candidate.account_id], db);
      await query('DELETE FROM challenges WHERE account_id=$1', [candidate.account_id], db);
      await query(
        "UPDATE accounts SET state='MERGED',merged_into=$2,password_hash=$3,totp_secret=NULL,totp_enabled=false WHERE id=$1",
        [candidate.account_id, account.id, 'DISABLED'],
        db,
      );
      await audit(db, account.id, null, 'account.merged', r.requestId, {
        sourceAccountId: candidate.account_id,
      });
    });
    return {
      message:
        'Accounts merged. Both sessions were revoked. Sign in again to the destination account.',
    };
  }
}
