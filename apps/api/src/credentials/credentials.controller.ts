import { Input } from '../input.js';
import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CompactSign } from 'jose';
import { z } from 'zod';
import type { Response } from 'express';
import { query, transaction } from '../../../../packages/core/src/db.js';
import { id, secret, digest, encrypt, decrypt } from '../../../../packages/core/src/security.js';
import { event, audit } from '../../../../packages/core/src/events.js';
import { config } from '../../../../packages/core/src/config.js';
import { DomainError, requireValue } from '../../../../packages/core/src/errors.js';
import {
  createSigningKey,
  documentFor,
  nativeDid,
  resolveDid,
  privateSigningKey,
  verifyDidSignature,
  type SigningKey,
} from '../../../../packages/core/src/did.js';
import { IdentityService } from '../identity/identity.service.js';
import { AuthService } from '../auth/auth.service.js';
import { requireAccount, type ApiRequest } from '../http.js';
const CredentialsControllerenableInput = z.object({ proof: z.string().max(200) }).strict();
const CredentialsControllerrotateInput = z.object({ proof: z.string().max(200) }).strict();
const CredentialsControllerrevokeKeyInput = z.object({ proof: z.string().max(200) }).strict();
const CredentialsControllerchallengeInput = z.object({ did: z.string().min(9).max(1000) }).strict();
const CredentialsControllerassociateInput = z
  .object({ did: z.string().max(1000), proof: z.string().max(12000) })
  .strict();
const CredentialsControllerissueInput = z.object({ assertionId: z.string().max(100) }).strict();
const CredentialsControllerverifyInput = z.object({ credential: z.string().max(30000) }).strict();
@ApiTags('DIDs and verifiable credentials')
@Controller()
export class CredentialsController {
  constructor(
    @Inject(IdentityService) private readonly identities: IdentityService,
    @Inject(AuthService) private readonly auth: AuthService,
  ) {}
  @Get('api/v1/dids/:id/did.json') async document(
    @Param('id') identityId: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    res.type('application/did+json');
    return documentFor(identityId);
  }
  @Input(CredentialsControllerenableInput)
  @Post('api/v1/identities/:id/did/enable')
  async enable(@Param('id') identityId: string, @Body() b: unknown, @Req() r: ApiRequest) {
    const { proof } = CredentialsControllerenableInput.parse(b),
      accountId = requireAccount(r).id;
    await this.auth.requireStepUp(accountId, proof);
    await transaction(async (db) => {
      await this.identities.authorize(accountId, identityId, 'security', db);
      if (
        !(
          await query(
            "SELECT 1 FROM signing_keys WHERE identity_id=$1 AND state='ACTIVE'",
            [identityId],
            db,
          )
        ).length
      )
        await createSigningKey(identityId, db);
      await query('UPDATE identities SET did_enabled=true WHERE id=$1', [identityId], db);
      await event(db, identityId, accountId, 'did.enabled', r.requestId);
    });
    return documentFor(identityId);
  }
  @Input(CredentialsControllerrotateInput)
  @Post('api/v1/identities/:id/did/rotate')
  async rotate(@Param('id') identityId: string, @Body() b: unknown, @Req() r: ApiRequest) {
    const { proof } = CredentialsControllerrotateInput.parse(b),
      accountId = requireAccount(r).id;
    await this.auth.requireStepUp(accountId, proof);
    await transaction(async (db) => {
      await this.identities.authorize(accountId, identityId, 'security', db);
      const [count] = await query<{ count: string }>(
        "SELECT count(*) FROM signing_keys WHERE identity_id=$1 AND state<>'REVOKED'",
        [identityId],
        db,
      );
      if (Number(count!.count) >= 20)
        throw new DomainError('KEY_LIMIT', 'Revoke older signing keys before rotating again.');
      await query(
        "UPDATE signing_keys SET state='RETIRED',retired_at=now() WHERE identity_id=$1 AND state='ACTIVE'",
        [identityId],
        db,
      );
      await createSigningKey(identityId, db);
      await query('UPDATE identities SET did_enabled=true WHERE id=$1', [identityId], db);
      await event(db, identityId, accountId, 'did.rotated', r.requestId);
    });
    return documentFor(identityId);
  }
  @Input(CredentialsControllerrevokeKeyInput)
  @Delete('api/v1/identities/:id/did/keys/:key')
  async revokeKey(
    @Param('id') identityId: string,
    @Param('key') keyId: string,
    @Body() b: unknown,
    @Req() r: ApiRequest,
  ) {
    const { proof } = CredentialsControllerrevokeKeyInput.parse(b),
      accountId = requireAccount(r).id;
    await this.auth.requireStepUp(accountId, proof);
    await transaction(async (db) => {
      await this.identities.authorize(accountId, identityId, 'security', db);
      requireValue(
        (
          await query(
            "UPDATE signing_keys SET state='REVOKED',revoked_at=now(),private_encrypted='' WHERE id=$1 AND identity_id=$2 RETURNING id",
            [keyId, identityId],
            db,
          )
        )[0],
        'Key unavailable',
      );
      await query('UPDATE credentials SET revoked_at=now() WHERE key_id=$1', [keyId], db);
      await query(
        'UPDATE did_associations SET revoked_at=now() WHERE key_id=$1',
        [nativeDid(identityId) + '#' + keyId],
        db,
      );
      await event(db, identityId, accountId, 'did.key_revoked', r.requestId, { keyId });
    });
    return { message: 'Key and its credentials revoked.' };
  }
  @Get('api/v1/dids/resolve') async resolve(@Query('did') did: string) {
    return resolveDid(z.string().max(1000).parse(did));
  }
  @Get('api/v1/identities/:id/did/associations') async associations(
    @Param('id') identityId: string,
    @Req() r: ApiRequest,
  ) {
    await this.identities.authorize(requireAccount(r).id, identityId, 'security');
    return query(
      'SELECT id,did,key_id,verified_at,expires_at,revoked_at FROM did_associations WHERE identity_id=$1',
      [identityId],
    );
  }
  @Input(CredentialsControllerchallengeInput)
  @Post('api/v1/identities/:id/did/challenge')
  async challenge(@Param('id') identityId: string, @Body() b: unknown, @Req() r: ApiRequest) {
    const { did } = CredentialsControllerchallengeInput.parse(b),
      accountId = requireAccount(r).id,
      nonce = secret();
    await this.identities.authorize(accountId, identityId, 'security');
    await resolveDid(did);
    await query(
      "INSERT INTO challenges(id,account_id,kind,digest,data,expires_at) VALUES($1,$2,'DID_ASSOCIATION',$3,$4,now()+interval '5 minutes')",
      [id('chl'), accountId, digest(nonce), JSON.stringify({ identityId, did })],
    );
    return {
      nonce,
      payload: { iss: did, aud: config().PUBLIC_ORIGIN, sub: identityId, nonce },
      instructions:
        'Sign this JSON payload as an EdDSA JWS with an authorized DID authentication key. Do not include additional claims.',
    };
  }
  @Input(CredentialsControllerassociateInput)
  @Post('api/v1/identities/:id/did/associate')
  async associate(@Param('id') identityId: string, @Body() b: unknown, @Req() r: ApiRequest) {
    const d = CredentialsControllerassociateInput.parse(b),
      accountId = requireAccount(r).id;
    let verified: Awaited<ReturnType<typeof verifyDidSignature>>;
    try {
      verified = await verifyDidSignature(d.proof, d.did, 'authentication');
    } catch {
      throw new DomainError('INVALID_PROOF', 'DID signature validation failed.');
    }
    const payload = z
      .object({
        iss: z.literal(d.did),
        aud: z.literal(config().PUBLIC_ORIGIN),
        sub: z.literal(identityId),
        nonce: z.string().max(200),
      })
      .strict()
      .parse(verified.payload);
    await transaction(async (db) => {
      await this.identities.authorize(accountId, identityId, 'security', db);
      const challenge = requireValue(
        (
          await query<{ data: { identityId: string; did: string } }>(
            "UPDATE challenges SET used_at=now() WHERE digest=$1 AND account_id=$2 AND kind='DID_ASSOCIATION' AND used_at IS NULL AND expires_at>now() RETURNING data",
            [digest(payload.nonce), accountId],
            db,
          )
        )[0],
        'Challenge expired or used',
      );
      if (challenge.data.identityId !== identityId || challenge.data.did !== d.did)
        throw new DomainError('INVALID_PROOF', 'Challenge does not match this identity and DID.');
      await query(
        "INSERT INTO did_associations(id,identity_id,did,key_id,proof,document_digest,expires_at) VALUES($1,$2,$3,$4,$5,$6,now()+interval '90 days') ON CONFLICT(identity_id,did) DO UPDATE SET key_id=EXCLUDED.key_id,proof=EXCLUDED.proof,document_digest=EXCLUDED.document_digest,verified_at=now(),expires_at=EXCLUDED.expires_at,revoked_at=NULL",
        [
          id('dia'),
          identityId,
          d.did,
          verified.header.kid,
          d.proof,
          digest(JSON.stringify(verified.document)),
        ],
        db,
      );
      await event(db, identityId, accountId, 'did.associated', r.requestId, { did: d.did });
    });
    return { message: 'DID control verified for 90 days.' };
  }
  @Delete('api/v1/identities/:id/did/associations/:association') async disconnect(
    @Param('id') identityId: string,
    @Param('association') associationId: string,
    @Req() r: ApiRequest,
  ) {
    await transaction(async (db) => {
      await this.identities.authorize(requireAccount(r).id, identityId, 'security', db);
      await query(
        'UPDATE did_associations SET revoked_at=now() WHERE id=$1 AND identity_id=$2',
        [associationId, identityId],
        db,
      );
      await event(db, identityId, requireAccount(r).id, 'did.disconnected', r.requestId, {
        associationId,
      });
    });
    return { message: 'DID association revoked.' };
  }
  @Input(CredentialsControllerissueInput)
  @Post('api/v1/organizations/:id/credentials')
  async issue(@Param('id') issuerId: string, @Body() b: unknown, @Req() r: ApiRequest) {
    const { assertionId } = CredentialsControllerissueInput.parse(b),
      accountId = requireAccount(r).id,
      credentialId = id('vcr');
    await transaction(async (db) => {
      const issuer = await this.identities.authorize(accountId, issuerId, 'organization', db);
      if (
        !['ORGANIZATION', 'TEAM', 'COMMUNITY'].includes(issuer.type) ||
        issuer.state !== 'ACTIVE' ||
        !issuer.did_enabled
      )
        throw new DomainError(
          'INVALID_ISSUER',
          'Enable an organization DID before issuing credentials.',
        );
      const a = requireValue(
        (
          await query<{
            id: string;
            subject_id: string;
            key: string;
            value: unknown;
            expires_at: Date;
          }>(
            "SELECT * FROM enterprise_assertions WHERE id=$1 AND issuer_id=$2 AND state='ACCEPTED' AND revoked_at IS NULL AND expires_at>now() FOR UPDATE",
            [assertionId, issuerId],
            db,
          )
        )[0],
        'Recipient must accept the current assertion first',
      );
      const key = requireValue(
        (
          await query<SigningKey>(
            "SELECT * FROM signing_keys WHERE identity_id=$1 AND state='ACTIVE'",
            [issuerId],
            db,
          )
        )[0],
        'Issuer key unavailable',
      );
      const root = config().PUBLIC_ORIGIN,
        now = new Date(),
        issuerDid = nativeDid(issuerId);
      const payload = {
        '@context': ['https://www.w3.org/ns/credentials/v2'],
        id: root + '/api/v1/credentials/' + credentialId,
        type: ['VerifiableCredential', root + '/schemas/IdentityAssertionCredential'],
        issuer: issuerDid,
        validFrom: now.toISOString(),
        validUntil: new Date(a.expires_at).toISOString(),
        credentialSubject: {
          id: root + '/api/v1/profiles/' + a.subject_id,
          [root + '/schemas/claim']: { name: a.key, value: a.value },
        },
        credentialStatus: {
          id: root + '/api/v1/credentials/' + credentialId + '/status',
          type: root + '/schemas/IdentityCredentialStatus',
        },
      };
      const token = await new CompactSign(Buffer.from(JSON.stringify(payload)))
        .setProtectedHeader({
          alg: 'EdDSA',
          typ: 'vc+jwt',
          cty: 'vc',
          kid: issuerDid + '#' + key.id,
        })
        .sign(await privateSigningKey(key));
      await query(
        'INSERT INTO credentials(id,issuer_id,subject_id,assertion_id,key_id,token_encrypted,token_digest,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
        [
          credentialId,
          issuerId,
          a.subject_id,
          assertionId,
          key.id,
          encrypt(token),
          digest(token),
          a.expires_at,
        ],
        db,
      );
      await event(db, issuerId, accountId, 'credential.issued', r.requestId, {
        credentialId,
        assertionId,
      });
    });
    return { id: credentialId, message: 'Credential issued privately to the holder.' };
  }
  @Get('api/v1/identities/:id/credentials') async list(
    @Param('id') identityId: string,
    @Req() r: ApiRequest,
  ) {
    await this.identities.authorize(requireAccount(r).id, identityId, 'read');
    return query(
      'SELECT id,issuer_id,assertion_id,key_id,expires_at,revoked_at,created_at FROM credentials WHERE subject_id=$1 ORDER BY created_at DESC LIMIT 500',
      [identityId],
    );
  }
  @Get('api/v1/credentials/:id') async download(
    @Param('id') credentialId: string,
    @Req() r: ApiRequest,
    @Res() res: Response,
  ) {
    const c = requireValue(
      (
        await query<{ subject_id: string; token_encrypted: string }>(
          'SELECT subject_id,token_encrypted FROM credentials WHERE id=$1',
          [credentialId],
        )
      )[0],
      'Credential unavailable',
    );
    await this.identities.authorize(requireAccount(r).id, c.subject_id, 'read');
    if (!c.token_encrypted)
      throw new DomainError('CREDENTIAL_UNAVAILABLE', 'The credential was removed.', 410);
    res.setHeader('Cache-Control', 'no-store');
    res.type('application/vc+jwt').send(decrypt(c.token_encrypted));
  }
  @Get('api/v1/credentials/:id/status') async status(@Param('id') credentialId: string) {
    const c = requireValue(
      (
        await query<{ valid: boolean }>(
          "SELECT (c.revoked_at IS NULL AND c.expires_at>now() AND k.state<>'REVOKED' AND a.state='ACCEPTED' AND a.revoked_at IS NULL AND a.expires_at>now() AND issuer.state='ACTIVE' AND subject.state='ACTIVE') AS valid FROM credentials c JOIN signing_keys k ON k.id=c.key_id JOIN enterprise_assertions a ON a.id=c.assertion_id JOIN identities issuer ON issuer.id=c.issuer_id JOIN identities subject ON subject.id=c.subject_id WHERE c.id=$1",
          [credentialId],
        )
      )[0],
      'Credential unavailable',
    );
    return {
      id: config().PUBLIC_ORIGIN + '/api/v1/credentials/' + credentialId + '/status',
      type: config().PUBLIC_ORIGIN + '/schemas/IdentityCredentialStatus',
      status: c.valid ? 'VALID' : 'INVALID',
    };
  }
  @Input(CredentialsControllerverifyInput)
  @Post('api/v1/credentials/verify')
  async verify(@Body() b: unknown, @Req() r: ApiRequest) {
    const { credential } = CredentialsControllerverifyInput.parse(b),
      accountId = requireAccount(r).id;
    const stored = requireValue(
      (
        await query<{ id: string; issuer_id: string }>(
          'SELECT id,issuer_id FROM credentials WHERE token_digest=$1',
          [digest(credential)],
        )
      )[0],
      'Only locally issued credentials are supported by this verifier',
    );
    try {
      const verified = await verifyDidSignature(
        credential,
        nativeDid(stored.issuer_id),
        'assertionMethod',
      );
      const payload = z
        .object({
          '@context': z.array(z.string()),
          id: z.literal(config().PUBLIC_ORIGIN + '/api/v1/credentials/' + stored.id),
          type: z.array(z.string()).refine((a) => a.includes('VerifiableCredential')),
          issuer: z.literal(nativeDid(stored.issuer_id)),
          validFrom: z.iso.datetime(),
          validUntil: z.iso.datetime(),
          credentialSubject: z.record(z.string(), z.unknown()),
          credentialStatus: z.record(z.string(), z.unknown()),
        })
        .strict()
        .parse(verified.payload);
      if (
        verified.header.typ !== 'vc+jwt' ||
        new Date(payload.validFrom).getTime() > Date.now() ||
        (await this.status(stored.id)).status !== 'VALID'
      )
        throw new Error();
      await transaction((db) =>
        audit(db, accountId, null, 'credential.verified', r.requestId, { credentialId: stored.id }),
      );
      return {
        valid: true,
        issuer: payload.issuer,
        subject: payload.credentialSubject.id,
        expiresAt: payload.validUntil,
      };
    } catch {
      throw new DomainError(
        'INVALID_CREDENTIAL',
        'Credential signature, issuer key, expiry or status is invalid.',
      );
    }
  }
  @Post('api/v1/organizations/:id/credentials/:credential/revoke') async revoke(
    @Param('id') issuerId: string,
    @Param('credential') credentialId: string,
    @Req() r: ApiRequest,
  ) {
    const accountId = requireAccount(r).id;
    await transaction(async (db) => {
      await this.identities.authorize(accountId, issuerId, 'organization', db);
      requireValue(
        (
          await query(
            'UPDATE credentials SET revoked_at=now() WHERE id=$1 AND issuer_id=$2 RETURNING id',
            [credentialId, issuerId],
            db,
          )
        )[0],
        'Credential unavailable',
      );
      await event(db, issuerId, accountId, 'credential.revoked', r.requestId, { credentialId });
    });
    return { message: 'Credential revoked.' };
  }
}
