import { Input } from '../input.js';
import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Query,
  Req,
  Res,
  Inject,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { Response } from 'express';
import { IdentityService } from '../identity/identity.service.js';
import { requireAccount, type ApiRequest } from '../http.js';
import { config } from '../../../../packages/core/src/config.js';
import { query, transaction } from '../../../../packages/core/src/db.js';
import { id, secret, digest, encrypt, decrypt } from '../../../../packages/core/src/security.js';
import { event } from '../../../../packages/core/src/events.js';
import { safeHttps } from '../../../../packages/core/src/outbound.js';
import { GitHubAdapter } from '../../../../packages/core/src/providers.js';
import { DomainError, requireValue } from '../../../../packages/core/src/errors.js';
import { importProviderClaims } from '../../../../packages/core/src/provider-import.js';
const fields = z
  .array(z.enum(['developer:github', 'core:bio', 'core:display_name']))
  .min(1)
  .max(3);
const ProvidersControllerbeginInput = z
  .object({ fields, mode: z.enum(['ONE_TIME', 'SYNC']).default('ONE_TIME') })
  .strict();
@ApiTags('Provider connections')
@Controller('api/v1')
export class ProvidersController {
  constructor(@Inject(IdentityService) private readonly identities: IdentityService) {}
  @Get('features') features() {
    return { github: !!config().GITHUB_CLIENT_ID && !!config().GITHUB_CLIENT_SECRET };
  }
  @Get('identities/:id/connections') async list(
    @Param('id') identityId: string,
    @Req() r: ApiRequest,
  ) {
    await this.identities.authorize(requireAccount(r).id, identityId, 'security');
    return query(
      'SELECT id,provider,provider_id,username,fields,mode,last_synced_at,last_error,revoked_at FROM provider_connections WHERE identity_id=$1',
      [identityId],
    );
  }
  @Input(ProvidersControllerbeginInput)
  @Post('identities/:id/connections/github/start')
  async begin(@Param('id') identityId: string, @Body() b: unknown, @Req() r: ApiRequest) {
    const a = requireAccount(r),
      d = ProvidersControllerbeginInput.parse(b);
    await this.identities.authorize(a.id, identityId, 'security');
    if (!config().GITHUB_CLIENT_ID || !config().GITHUB_CLIENT_SECRET)
      throw new DomainError(
        'PROVIDER_DISABLED',
        'GitHub connection is not enabled on this instance.',
        503,
      );
    const state = secret(),
      verifier = secret();
    await query(
      "INSERT INTO challenges(id,account_id,kind,digest,data,expires_at) VALUES($1,$2,'GITHUB_CONNECT',$3,$4,now()+interval '5 minutes')",
      [
        id('chl'),
        a.id,
        digest(state),
        JSON.stringify({ identityId, verifier: encrypt(verifier), ...d }),
      ],
    );
    const u = new URL('https://github.com/login/oauth/authorize');
    u.searchParams.set('client_id', config().GITHUB_CLIENT_ID!);
    u.searchParams.set(
      'redirect_uri',
      config().PUBLIC_ORIGIN + '/api/v1/connections/github/callback',
    );
    u.searchParams.set('state', state);
    u.searchParams.set('scope', 'read:user');
    u.searchParams.set('code_challenge_method', 'S256');
    u.searchParams.set(
      'code_challenge',
      Buffer.from(digest(verifier), 'hex').toString('base64url'),
    );
    return { url: u.toString() };
  }
  @Get('connections/github/callback') async callback(
    @Query('state') state: string,
    @Query('code') code: string,
    @Req() r: ApiRequest,
    @Res() res: Response,
  ) {
    const a = requireAccount(r);
    z.string().min(20).max(200).parse(state);
    z.string().min(1).max(200).parse(code);
    const challenge = await transaction(async (db) =>
      requireValue(
        (
          await query<{
            data: {
              identityId: string;
              fields: ('developer:github' | 'core:bio' | 'core:display_name')[];
              mode: string;
              verifier: string;
            };
          }>(
            "UPDATE challenges SET used_at=now() WHERE digest=$1 AND account_id=$2 AND kind='GITHUB_CONNECT' AND used_at IS NULL AND expires_at>now() RETURNING data",
            [digest(state), a.id],
            db,
          )
        )[0],
        'Connection expired. Start again.',
      ),
    );
    await this.identities.authorize(a.id, challenge.data.identityId, 'security');
    const result = await safeHttps('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'User-Agent': 'Orbit-Identity',
      },
      body: JSON.stringify({
        client_id: config().GITHUB_CLIENT_ID,
        client_secret: config().GITHUB_CLIENT_SECRET,
        code,
        code_verifier: decrypt(challenge.data.verifier),
        redirect_uri: config().PUBLIC_ORIGIN + '/api/v1/connections/github/callback',
      }),
      maxBytes: 16384,
    });
    const data = z
      .object({ access_token: z.string().min(1), scope: z.string().optional() })
      .parse(JSON.parse(result.body));
    if (result.status !== 200)
      throw new DomainError('PROVIDER_UNAVAILABLE', 'GitHub authorization failed.', 502);
    const profile = await new GitHubAdapter().profile(data.access_token),
      connectionId = id('prv');
    await transaction(async (db) => {
      await query(
        "INSERT INTO provider_connections(id,identity_id,provider,provider_id,username,token_encrypted,fields,mode,last_synced_at,actor_id) VALUES($1,$2,'github',$3,$4,$5,$6,$7,now(),$8) ON CONFLICT(identity_id,provider) DO UPDATE SET provider_id=EXCLUDED.provider_id,username=EXCLUDED.username,token_encrypted=EXCLUDED.token_encrypted,fields=EXCLUDED.fields,mode=EXCLUDED.mode,revoked_at=NULL,last_synced_at=now(),actor_id=EXCLUDED.actor_id",
        [
          connectionId,
          challenge.data.identityId,
          profile.id,
          profile.username,
          encrypt(data.access_token),
          JSON.stringify(challenge.data.fields),
          challenge.data.mode,
          a.id,
        ],
        db,
      );
      await this.importProfile(db, challenge.data.identityId, a.id, profile, challenge.data.fields);
      await event(db, challenge.data.identityId, a.id, 'provider.connected', r.requestId, {
        provider: 'github',
      });
    });
    res.redirect(302, config().PUBLIC_ORIGIN + '/dashboard');
  }
  private async importProfile(
    db: import('pg').PoolClient,
    identityId: string,
    actorId: string,
    profile: import('../../../../packages/core/src/providers.js').ProviderProfile,
    selectedFields: ('developer:github' | 'core:bio' | 'core:display_name')[],
  ) {
    await importProviderClaims(db, identityId, actorId, profile, selectedFields);
  }
  @Post('identities/:id/connections/:connection/sync') async sync(
    @Param('id') identityId: string,
    @Param('connection') connectionId: string,
    @Req() r: ApiRequest,
  ) {
    const a = requireAccount(r);
    await this.identities.authorize(a.id, identityId, 'security');
    const connection = requireValue(
      (
        await query<{
          token_encrypted: string;
          fields: ('developer:github' | 'core:bio' | 'core:display_name')[];
        }>(
          'SELECT * FROM provider_connections WHERE id=$1 AND identity_id=$2 AND revoked_at IS NULL',
          [connectionId, identityId],
        )
      )[0],
    );
    const profile = await new GitHubAdapter().profile(decrypt(connection.token_encrypted));
    await transaction(async (db) => {
      await this.importProfile(db, identityId, a.id, profile, connection.fields);
      await query(
        'UPDATE provider_connections SET last_synced_at=now(),last_error=NULL WHERE id=$1',
        [connectionId],
        db,
      );
      await event(db, identityId, a.id, 'provider.synchronized', r.requestId, {
        provider: 'github',
      });
    });
    return {
      message: 'Provider data imported as separate claims. Manual values remain authoritative.',
    };
  }
  @Delete('identities/:id/connections/:connection') async disconnect(
    @Param('id') identityId: string,
    @Param('connection') connectionId: string,
    @Req() r: ApiRequest,
  ) {
    const a = requireAccount(r);
    await transaction(async (db) => {
      await this.identities.authorize(a.id, identityId, 'security', db);
      await query(
        "UPDATE provider_connections SET revoked_at=now(),token_encrypted='' WHERE id=$1 AND identity_id=$2",
        [connectionId, identityId],
        db,
      );
      await event(db, identityId, a.id, 'provider.disconnected', r.requestId);
    });
    return {
      message:
        'Connection removed. Revoke the authorization on GitHub to invalidate its provider token.',
    };
  }
}
