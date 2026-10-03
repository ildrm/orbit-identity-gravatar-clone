import {
  blockedLinkHosts,
  safeClaimLinks,
  linkAllowed,
} from '../../../../packages/core/src/link-safety.js';
import { Injectable } from '@nestjs/common';
import { query, transaction, type DB } from '../../../../packages/core/src/db.js';
import { DomainError, requireValue } from '../../../../packages/core/src/errors.js';
import { id } from '../../../../packages/core/src/security.js';
import { event } from '../../../../packages/core/src/events.js';
import {
  canDisclose,
  discloseValue,
  freshness,
  permitted,
  reservedHandles,
  type Viewer,
} from '../../../../packages/core/src/policy.js';
import {
  identitySchema,
  claimSchema,
  personaSchema,
  profileSettingsSchema,
  publicPolicy,
  privatePolicy,
  type Policy,
  type Role,
  type Channel,
  type PublicProfile,
  type PublicClaim,
} from '../../../../packages/contracts/src/index.js';
interface IdentityRow {
  id: string;
  type: string;
  handle: string;
  visibility: string;
  state: string;
  merged_into: string | null;
  searchable: boolean;
  indexable: boolean;
  machine: boolean;
  agent: boolean;
  theme: string;
  locale: string;
  revision: number;
  role?: Role;
  renamed_at: Date | null;
  avatar_media_id: string | null;
  [key: string]: unknown;
}
interface ClaimRow {
  id: string;
  key: string;
  value: unknown;
  persona_id: string | null;
  locale: string;
  policy: Policy;
  source: string;
  verification_state: string;
  verified_at: Date | null;
  expires_at: Date | null;
  revoked_at: Date | null;
  updated_at: Date;
  [key: string]: unknown;
}
@Injectable()
export class IdentityService {
  async authorize(
    accountId: string,
    identityId: string,
    permission: string,
    db?: DB,
  ): Promise<IdentityRow> {
    const [identity] = await query<IdentityRow>(
      "SELECT i.*,m.role FROM identities i JOIN memberships m ON m.identity_id=i.id WHERE i.id=$1 AND m.account_id=$2 AND i.state NOT IN ('DELETED','MERGED')" +
        (db ? ' FOR UPDATE OF i,m' : ''),
      [identityId, accountId],
      db,
    );
    if (!identity || !permitted(identity.role, permission))
      throw new DomainError('FORBIDDEN', 'You do not have permission for this identity.', 403);
    if (
      !['ACTIVE'].includes(identity.state) &&
      !['read', 'security', 'delete'].includes(permission)
    )
      throw new DomainError(
        'IDENTITY_FROZEN',
        'This identity is read-only until its state is restored.',
        409,
      );
    return identity;
  }
  async list(accountId: string) {
    return query(
      "SELECT i.*,m.role FROM identities i JOIN memberships m ON m.identity_id=i.id WHERE m.account_id=$1 AND i.state NOT IN ('DELETED','MERGED') ORDER BY i.created_at",
      [accountId],
    );
  }
  async create(accountId: string, input: unknown, requestId: string): Promise<PublicProfile> {
    const data = identitySchema.parse(input);
    if (reservedHandles.has(data.handle))
      throw new DomainError('HANDLE_RESERVED', 'Choose another handle.', 409);
    const identityId = id('idn');
    await transaction(async (db) => {
      await query(
        'INSERT INTO identities(id,type,handle,visibility,searchable,indexable,machine) VALUES($1,$2,$3,$4,$5,$5,$5)',
        [identityId, data.type, data.handle, data.visibility, data.visibility === 'PUBLIC'],
        db,
      );
      await query(
        'INSERT INTO handles(handle,identity_id) VALUES($1,$2)',
        [data.handle, identityId],
        db,
      );
      await query(
        "INSERT INTO memberships(identity_id,account_id,role) VALUES($1,$2,'OWNER')",
        [identityId, accountId],
        db,
      );
      await query(
        "INSERT INTO claims(id,identity_id,key,value,policy,actor_id) VALUES($1,$2,'core:display_name',$3,$4,$5)",
        [
          id('clm'),
          identityId,
          JSON.stringify(data.displayName),
          JSON.stringify(data.visibility === 'PRIVATE' ? privatePolicy : publicPolicy),
          accountId,
        ],
        db,
      );
      await event(db, identityId, accountId, 'identity.created', requestId);
    });
    return this.profile(identityId, null, 'human', { owner: true, accountId });
  }
  async snapshot(db: DB, identityId: string, accountId: string): Promise<void> {
    const [identity] = await query<IdentityRow>(
      'SELECT * FROM identities WHERE id=$1 FOR UPDATE',
      [identityId],
      db,
    );
    if (!identity) return;
    const claims = await query(
      'SELECT * FROM claims WHERE identity_id=$1 AND selected AND revoked_at IS NULL',
      [identityId],
      db,
    );
    await query(
      'INSERT INTO revisions(id,identity_id,actor_id,revision,snapshot) VALUES($1,$2,$3,$4,$5) ON CONFLICT(identity_id,revision) DO NOTHING',
      [
        id('rev'),
        identityId,
        accountId,
        identity.revision,
        JSON.stringify({
          identity,
          claims,
          blocks: await query(
            'SELECT * FROM profile_blocks WHERE identity_id=$1',
            [identityId],
            db,
          ),
        }),
      ],
      db,
    );
    await query(
      'UPDATE identities SET revision=revision+1,updated_at=now() WHERE id=$1',
      [identityId],
      db,
    );
  }
  async rename(accountId: string, identityId: string, handle: string, requestId: string) {
    if (reservedHandles.has(handle))
      throw new DomainError('HANDLE_RESERVED', 'Choose another handle.', 409);
    await transaction(async (db) => {
      await this.authorize(accountId, identityId, 'security', db);
      const [i] = await query<IdentityRow>(
        'SELECT * FROM identities WHERE id=$1 FOR UPDATE',
        [identityId],
        db,
      );
      if (i!.renamed_at && Date.now() - new Date(i!.renamed_at).getTime() < 30 * 86400000)
        throw new DomainError('HANDLE_COOLDOWN', 'Handles can be renamed once every 30 days.', 409);
      await this.snapshot(db, identityId, accountId);
      await query('UPDATE handles SET primary_handle=false WHERE identity_id=$1', [identityId], db);
      await query(
        'INSERT INTO handles(handle,identity_id) VALUES($1,$2)',
        [handle, identityId],
        db,
      );
      await query(
        'UPDATE identities SET handle=$1,renamed_at=now() WHERE id=$2',
        [handle, identityId],
        db,
      );
      await event(db, identityId, accountId, 'identity.updated', requestId, {
        changed: ['handle'],
      });
    });
    return { handle };
  }
  async settings(accountId: string, identityId: string, input: unknown, requestId: string) {
    const d = profileSettingsSchema.parse(input);
    await transaction(async (db) => {
      await this.authorize(accountId, identityId, 'security', db);
      await this.snapshot(db, identityId, accountId);
      await query(
        'UPDATE identities SET visibility=$1,searchable=$2,indexable=$3,machine=$4,agent=$5,theme=$6,locale=$7,contact_enabled=$9 WHERE id=$8',
        [
          d.visibility,
          d.visibility === 'PUBLIC' && d.searchable,
          d.visibility === 'PUBLIC' && d.indexable,
          d.machine,
          d.agent,
          d.theme,
          d.locale,
          identityId,
          d.contactEnabled,
        ],
        db,
      );
      await event(db, identityId, accountId, 'identity.updated', requestId, {
        changed: ['privacy'],
      });
    });
    return d;
  }
  async putClaim(accountId: string, identityId: string, input: unknown, requestId: string) {
    const d = claimSchema.parse(input);
    let claimId = '';
    await transaction(async (db) => {
      await this.authorize(accountId, identityId, 'claims', db);
      await this.snapshot(db, identityId, accountId);
      if (
        d.personaId &&
        !(
          await query(
            'SELECT 1 FROM personas WHERE id=$1 AND identity_id=$2',
            [d.personaId, identityId],
            db,
          )
        ).length
      )
        throw new DomainError('INVALID_PERSONA', 'Persona does not belong to this identity.');
      await query(
        'UPDATE claims SET selected=false WHERE identity_id=$1 AND key=$2 AND persona_id IS NOT DISTINCT FROM $3 AND locale=$4 AND selected',
        [identityId, d.key, d.personaId, d.locale],
        db,
      );
      claimId = id('clm');
      await query(
        'INSERT INTO claims(id,identity_id,key,value,persona_id,locale,policy,expires_at,actor_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
        [
          claimId,
          identityId,
          d.key,
          JSON.stringify(d.value),
          d.personaId,
          d.locale,
          JSON.stringify(d.policy),
          d.expiresAt,
          accountId,
        ],
        db,
      );
      await event(db, identityId, accountId, 'claim.updated', requestId, { claimId, key: d.key });
    });
    return { id: claimId };
  }
  async revokeClaim(accountId: string, identityId: string, claimId: string, requestId: string) {
    await transaction(async (db) => {
      await this.authorize(accountId, identityId, 'claims', db);
      await this.snapshot(db, identityId, accountId);
      await query(
        "UPDATE claims SET revoked_at=now(),verification_state='REVOKED' WHERE id=$1 AND identity_id=$2",
        [claimId, identityId],
        db,
      );
      await event(db, identityId, accountId, 'claim.revoked', requestId, { claimId });
    });
    return { message: 'Claim removed' };
  }
  async claims(accountId: string, identityId: string) {
    await this.authorize(accountId, identityId, 'read');
    return query('SELECT * FROM claims WHERE identity_id=$1 ORDER BY updated_at DESC LIMIT 500', [
      identityId,
    ]);
  }
  async createPersona(accountId: string, identityId: string, input: unknown, requestId: string) {
    const d = personaSchema.parse(input);
    const personaId = id('per');
    await transaction(async (db) => {
      await this.authorize(accountId, identityId, 'profile', db);
      const [count] = await query<{ count: string }>(
        'SELECT count(*) FROM personas WHERE identity_id=$1',
        [identityId],
        db,
      );
      if (Number(count!.count) >= 20)
        throw new DomainError('LIMIT_REACHED', 'An identity can have up to 20 personas.');
      await query(
        'INSERT INTO personas(id,identity_id,name,slug,active) VALUES($1,$2,$3,$4,$5)',
        [personaId, identityId, d.name, d.slug, d.active],
        db,
      );
      await event(db, identityId, accountId, 'persona.created', requestId, { personaId });
    });
    return { id: personaId, ...d };
  }
  async personas(accountId: string, identityId: string) {
    await this.authorize(accountId, identityId, 'read');
    return query('SELECT * FROM personas WHERE identity_id=$1 ORDER BY created_at', [identityId]);
  }
  async profile(
    identifier: string,
    personaSlug: string | null,
    channel: Channel,
    viewer: Viewer = {},
  ): Promise<PublicProfile> {
    const [identity] = await query<IdentityRow>(
      'SELECT DISTINCT i.* FROM identities i LEFT JOIN handles h ON h.identity_id=i.id WHERE i.id=$1 OR h.handle=$1',
      [identifier.replace(/^@/, '')],
    );
    const i = requireValue(identity);
    if (i.state === 'MERGED' && i.merged_into) {
      const [alias] = personaSlug
        ? await query<{ slug: string }>(
            'SELECT p.slug FROM merge_persona_aliases a JOIN personas p ON p.id=a.target_persona_id WHERE a.source_id=$1 AND a.slug=$2',
            [i.id, personaSlug],
          )
        : [];
      const resolved = await this.profile(
        i.merged_into,
        alias?.slug ?? personaSlug,
        channel,
        viewer,
      );
      return { ...resolved, canonicalHandle: resolved.handle };
    }
    if (
      (!['ACTIVE', 'MEMORIALIZED', 'FROZEN'].includes(i.state) && !viewer.owner) ||
      (i.visibility === 'PRIVATE' && !viewer.owner && !viewer.applicationId)
    )
      throw new DomainError('NOT_FOUND', 'Profile unavailable', 404);
    if (
      !viewer.owner &&
      ((channel === 'machine' && !i.machine) ||
        (channel === 'agent' && !i.agent) ||
        (channel === 'index' && !i.indexable) ||
        (channel === 'search' && (!i.searchable || i.visibility !== 'PUBLIC')))
    )
      throw new DomainError('NOT_FOUND', 'This representation is unavailable', 404);
    if (viewer.accountId && !viewer.owner && !viewer.applicationId) {
      const [context] = await query<{ connection: boolean; organization: boolean }>(
        `SELECT
          EXISTS(
            SELECT 1 FROM relationships r
            JOIN identities peer ON peer.id=CASE WHEN r.source_id=$1 THEN r.target_id ELSE r.source_id END
            JOIN memberships m ON m.identity_id=peer.id AND m.account_id=$2 AND m.role='OWNER'
            WHERE (r.source_id=$1 OR r.target_id=$1) AND r.verification_state='MUTUALLY_CONFIRMED'
              AND r.revoked_at IS NULL AND (r.expires_at IS NULL OR r.expires_at>now())
              AND peer.state='ACTIVE'
          ) AS connection,
          EXISTS(
            SELECT 1 FROM identities organization
            JOIN memberships m ON m.identity_id=organization.id AND m.account_id=$2
            WHERE organization.type IN ('ORGANIZATION','TEAM','COMMUNITY') AND organization.state='ACTIVE'
              AND (organization.id=$1 OR EXISTS(
                SELECT 1 FROM relationships r WHERE r.source_id=$1 AND r.target_id=organization.id
                  AND r.type IN ('works_at','member_of','represents') AND r.verification_state='MUTUALLY_CONFIRMED'
                  AND r.revoked_at IS NULL AND (r.expires_at IS NULL OR r.expires_at>now())
              ))
          ) AS organization`,
        [i.id, viewer.accountId],
      );
      viewer = {
        accountId: viewer.accountId,
        authenticated: true,
        connection: !!context?.connection,
        organization: !!context?.organization,
      };
    }
    let personaId: string | null = null;
    if (personaSlug) {
      const [p] = await query<{ id: string }>(
        'SELECT id FROM personas WHERE identity_id=$1 AND slug=$2 AND active',
        [i.id, personaSlug],
      );
      personaId = requireValue(p, 'Persona unavailable').id;
    }
    const claims = await query<ClaimRow>(
      `WITH ranked AS (
    SELECT c.*,row_number() OVER(PARTITION BY key ORDER BY (persona_id IS NOT NULL) DESC,(locale=$3) DESC,(locale='en') DESC,updated_at DESC) AS position
    FROM claims c WHERE identity_id=$1 AND selected AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at>now()) AND (assertion_id IS NULL OR EXISTS(SELECT 1 FROM enterprise_assertions ea JOIN identities ei ON ei.id=ea.issuer_id WHERE ea.id=c.assertion_id AND ea.state='ACCEPTED' AND ea.revoked_at IS NULL AND ea.expires_at>now() AND ei.state='ACTIVE')) AND (persona_id IS NULL OR persona_id=$2)
   ) SELECT id,key,persona_id,locale,policy,source,verification_state,verified_at,expires_at,revoked_at,updated_at,
    CASE WHEN $4::boolean OR policy->>'transformation'='FULL' THEN value WHEN policy->>'transformation' IN ('GENERALIZED','ALIAS') THEN to_jsonb(policy->>'disclosedValue') WHEN policy->>'transformation'='REDACTED' THEN to_jsonb('Redacted'::text) ELSE NULL END AS value
   FROM ranked WHERE position=1 AND ($4::boolean OR (
     policy->>'transformation'<>'HIDDEN'
     AND (policy->>'visibility' IN ('PUBLIC','UNLISTED')
      OR (policy->>'visibility'='AUTHENTICATED' AND $6::boolean)
      OR (policy->>'visibility'='CONNECTIONS' AND $8::boolean)
      OR (policy->>'visibility'='ORGANIZATION' AND $9::boolean)
      OR (policy->>'visibility'='SPECIFIC_APPLICATIONS' AND policy->'applications' ? $7))
     AND ($5='human' OR ($5='api' AND policy->>'api'='true') OR ($5='machine' AND policy->>'machine'='true') OR ($5='agent' AND policy->>'agent'='true')
      OR ($5='index' AND policy->>'indexable'='true' AND policy->>'visibility'='PUBLIC')
      OR ($5='search' AND policy->>'searchable'='true' AND policy->>'visibility'='PUBLIC'))
     AND ($7='' OR (key=ANY($10::text[]) AND
       CASE WHEN key LIKE 'developer:%' THEN 'profile.developer' WHEN key LIKE 'professional:%' OR key LIKE 'org:%' THEN 'profile.professional' ELSE 'profile.basic' END =ANY($11::text[])))
    ))`,
      [
        i.id,
        personaId,
        i.locale,
        !!viewer.owner,
        channel,
        !!viewer.authenticated,
        viewer.applicationId ?? '',
        !!viewer.connection,
        !!viewer.organization,
        viewer.consentedFields ?? [],
        viewer.scopes ?? [],
      ],
    );

    const selected = new Map<string, ClaimRow>();
    for (const c of claims) if (!selected.has(c.key)) selected.set(c.key, c);
    const blocked = viewer.owner ? new Set<string>() : await blockedLinkHosts();
    const output: PublicClaim[] = [];
    for (const c of selected.values()) {
      if (!canDisclose(c.policy, viewer, channel, c.key)) continue;
      if (!viewer.owner && safeClaimLinks(c.key, c.value, blocked) === null) continue;
      output.push({
        id: c.id,
        key: c.key,
        value: viewer.owner
          ? c.value
          : safeClaimLinks(c.key, discloseValue(c.policy, c.value), blocked),
        locale: c.locale,
        source: c.source,
        verification: freshness(c) === 'Expired' ? 'EXPIRED' : c.verification_state,
        freshness: freshness(c),
        updatedAt: new Date(c.updated_at).toISOString(),
        ...(viewer.owner ? { policy: c.policy } : {}),
      });
    }
    const blocks = viewer.applicationId
      ? []
      : await query<{
          id: string;
          kind: string;
          title: string;
          locale: string;
          configuration: {
            text: string;
            url?: string;
            items: { label: string; url: string; description?: string }[];
          };
          policy: Policy;
        }>(
          "SELECT id,kind,CASE WHEN $4::boolean OR policy->>'transformation'='FULL' THEN title ELSE 'Profile content' END AS title,locale,CASE WHEN $4::boolean OR policy->>'transformation'='FULL' THEN configuration ELSE jsonb_build_object('text',CASE WHEN policy->>'transformation' IN ('GENERALIZED','ALIAS') THEN policy->>'disclosedValue' ELSE 'Redacted' END,'items','[]'::jsonb) END AS configuration,policy FROM profile_blocks WHERE identity_id=$1 AND enabled AND (persona_id IS NULL OR persona_id=$2) AND (locale=$3 OR locale='en') AND ($4::boolean OR (policy->>'transformation'<>'HIDDEN' AND (policy->>'visibility' IN ('PUBLIC','UNLISTED') OR (policy->>'visibility'='AUTHENTICATED' AND $5::boolean) OR (policy->>'visibility'='CONNECTIONS' AND $6::boolean) OR (policy->>'visibility'='ORGANIZATION' AND $7::boolean)) AND ($8='human' OR ($8='api' AND policy->>'api'='true') OR ($8='machine' AND policy->>'machine'='true') OR ($8='agent' AND policy->>'agent'='true') OR ($8='index' AND policy->>'indexable'='true' AND policy->>'visibility'='PUBLIC') OR ($8='search' AND policy->>'searchable'='true' AND policy->>'visibility'='PUBLIC')))) ORDER BY position,id LIMIT 100",
          [
            i.id,
            personaId,
            i.locale,
            !!viewer.owner,
            !!viewer.authenticated,
            !!viewer.connection,
            !!viewer.organization,
            channel,
          ],
        );
    const disclosedBlocks = blocks
      .filter((b) => canDisclose(b.policy, viewer, channel, 'core:blocks'))
      .map((b) => ({
        id: b.id,
        kind: b.kind,
        title: b.title,
        locale: b.locale,
        configuration:
          b.policy.transformation === 'FULL' || viewer.owner
            ? b.configuration
            : { text: String(discloseValue(b.policy, b.configuration) ?? ''), items: [] },
      }));
    const canonical = (
      await query<{ domain: string }>(
        "SELECT domain FROM domains WHERE identity_id=$1 AND canonical AND custom_enabled AND routing_state='ACTIVE' AND revoked_at IS NULL AND expires_at>now() AND last_checked_at>now()-interval '26 hours' LIMIT 1",
        [i.id],
      )
    )[0];
    for (const b of disclosedBlocks)
      if (!viewer.owner) {
        if (b.configuration.url && !linkAllowed(b.configuration.url, blocked))
          delete b.configuration.url;
        b.configuration.items = b.configuration.items.filter((item) =>
          linkAllowed(item.url, blocked),
        );
      }
    const display = output.find((c) => c.key === 'core:display_name')?.value;
    return {
      id: i.id,
      handle: i.handle,
      type: i.type,
      persona: personaSlug,
      displayName: typeof display === 'string' ? display : i.handle,
      claims: output,
      blocks: disclosedBlocks,
      ...(i.header_media_id
        ? { headerUrl: '/assets/' + String(i.header_media_id) + '/512.webp' }
        : {}),
      avatarUrl:
        '/avatar/' + i.id + (personaSlug ? '?persona=' + encodeURIComponent(personaSlug) : ''),
      contactEnabled: !!i.contact_enabled,
      visibility: i.visibility,
      indexable:
        i.visibility === 'PUBLIC' &&
        i.indexable &&
        Array.from(selected.values())
          .filter((c) => canDisclose(c.policy, viewer, 'human', c.key))
          .every((c) => c.policy.indexable),
      machine: i.machine,
      agent: i.agent,
      theme: i.theme,
      locale: i.locale,
      revision: i.revision,
      ...(canonical && i.visibility !== 'PRIVATE'
        ? {
            canonicalUrl:
              'https://' +
              canonical.domain +
              '/' +
              (personaSlug ? '?persona=' + encodeURIComponent(personaSlug) : ''),
          }
        : {}),
      ...(identifier !== i.handle && identifier !== i.id ? { canonicalHandle: i.handle } : {}),
    };
  }
  async search(term: string, limit: number, cursor: string) {
    return query(
      `SELECT i.id,i.handle,i.type,COALESCE(
   (SELECT CASE WHEN c.policy->>'transformation' IN ('GENERALIZED','ALIAS') THEN c.policy->>'disclosedValue' WHEN c.policy->>'transformation'='REDACTED' THEN 'Redacted' ELSE c.value #>> '{}' END
    FROM claims c WHERE c.identity_id=i.id AND c.key='core:display_name' AND c.persona_id IS NULL AND c.selected AND c.revoked_at IS NULL AND (c.expires_at IS NULL OR c.expires_at>now())
    AND c.policy->>'visibility'='PUBLIC' AND c.policy->>'searchable'='true' AND c.policy->>'transformation'<>'HIDDEN' ORDER BY c.updated_at DESC LIMIT 1),i.handle) AS display_name
   FROM identities i WHERE i.state='ACTIVE' AND i.visibility='PUBLIC' AND i.searchable AND i.id>$3 AND
   (i.handle ILIKE $1 OR EXISTS(SELECT 1 FROM claims c WHERE c.identity_id=i.id AND c.persona_id IS NULL AND c.selected AND c.revoked_at IS NULL AND (c.expires_at IS NULL OR c.expires_at>now()) AND (c.key IN ('core:display_name','core:bio') OR EXISTS(SELECT 1 FROM schema_definitions s WHERE s.key=c.key AND s.revoked_at IS NULL AND s.indexable AND s.type IN ('text','text_array','https_url'))) AND c.policy->>'visibility'='PUBLIC' AND c.policy->>'searchable'='true' AND c.policy->>'transformation'='FULL' AND c.value #>> '{}' ILIKE $1))
   ORDER BY i.id LIMIT $2`,
      ['%' + term.replace(/[%_\\]/g, '\\$&') + '%', limit, cursor],
    );
  }
}
