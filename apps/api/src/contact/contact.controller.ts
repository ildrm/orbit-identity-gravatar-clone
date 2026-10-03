import { Input } from '../input.js';
import { Controller, Get, Post, Body, Param, Req, Inject } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { IdentityService } from '../identity/identity.service.js';
import { requireAccount, type ApiRequest } from '../http.js';
import { query, transaction } from '../../../../packages/core/src/db.js';
import { id } from '../../../../packages/core/src/security.js';
import { enqueue, audit } from '../../../../packages/core/src/events.js';
import { rateLimit } from '../../../../packages/core/src/redis.js';
import { DomainError } from '../../../../packages/core/src/errors.js';
const ContactControllersendInput = z
  .object({
    subject: z.string().trim().min(3).max(150),
    body: z.string().trim().min(20).max(3000),
    shareEmail: z.literal(true),
  })
  .strict();
const ContactControllerblockInput = z.object({ accountId: z.string().max(100) }).strict();
@ApiTags('Contact relay')
@Controller('api/v1')
export class ContactController {
  constructor(@Inject(IdentityService) private readonly identities: IdentityService) {}
  @Input(ContactControllersendInput)
  @Post('contact/:id')
  async send(@Param('id') identityId: string, @Body() b: unknown, @Req() r: ApiRequest) {
    const a = requireAccount(r),
      d = ContactControllersendInput.parse(b);
    const rate = await rateLimit('contact:' + a.id + ':' + identityId, 5, 86400);
    if (!rate.allowed)
      throw new DomainError(
        'RATE_LIMITED',
        'You have reached the daily contact limit for this identity.',
        429,
      );
    await transaction(async (db) => {
      const [recipient] = await query<{ email: string }>(
        "SELECT a.email FROM identities i JOIN memberships m ON m.identity_id=i.id AND m.role='OWNER' JOIN accounts a ON a.id=m.account_id WHERE i.id=$1 AND i.state='ACTIVE' AND i.visibility<>'PRIVATE' AND i.contact_enabled AND a.state='ACTIVE' AND a.verified_at IS NOT NULL AND NOT EXISTS(SELECT 1 FROM contact_blocks b WHERE b.identity_id=i.id AND b.account_id=$2) LIMIT 1",
        [identityId, a.id],
        db,
      );
      if (!recipient) return;
      const messageId = id('msg');
      await query(
        'INSERT INTO contact_messages(id,identity_id,sender_id,subject,body,sender_email_consent) VALUES($1,$2,$3,$4,$5,true)',
        [messageId, identityId, a.id, d.subject, d.body],
        db,
      );
      await enqueue(db, 'relay', {
        messageId,
        identityId,
        to: recipient.email,
        replyTo: a.email,
        subject: d.subject,
        body: d.body,
      });
      await audit(db, a.id, identityId, 'contact.sent', r.requestId, { messageId });
    });
    return { message: 'If this identity accepts contact, your message has been queued.' };
  }
  @Get('identities/:id/contact') async inbox(
    @Param('id') identityId: string,
    @Req() r: ApiRequest,
  ) {
    await this.identities.authorize(requireAccount(r).id, identityId, 'security');
    return query(
      'SELECT m.id,m.sender_id,m.subject,m.body,m.state,m.created_at,CASE WHEN m.sender_email_consent THEN a.email ELSE NULL END AS sender_email FROM contact_messages m JOIN accounts a ON a.id=m.sender_id WHERE m.identity_id=$1 ORDER BY m.created_at DESC LIMIT 100',
      [identityId],
    );
  }
  @Input(ContactControllerblockInput)
  @Post('identities/:id/contact/blocks')
  async block(@Param('id') identityId: string, @Body() b: unknown, @Req() r: ApiRequest) {
    const a = requireAccount(r),
      d = ContactControllerblockInput.parse(b);
    await transaction(async (db) => {
      await this.identities.authorize(a.id, identityId, 'security', db);
      await query(
        'INSERT INTO contact_blocks(identity_id,account_id) VALUES($1,$2) ON CONFLICT DO NOTHING',
        [identityId, d.accountId],
        db,
      );
      await audit(db, a.id, identityId, 'contact.blocked', r.requestId, { senderId: d.accountId });
    });
    return { message: 'Sender blocked' };
  }
}
