import { Controller, Get, Param } from '@nestjs/common';
import { DomainError } from '../../../../packages/core/src/errors.js';
@Controller('schemas')
export class CredentialSchemasController {
  @Get(':name') schema(@Param('name') name: string) {
    if (name === 'claim')
      return {
        type: 'object',
        required: ['name', 'value'],
        additionalProperties: false,
        properties: {
          name: { type: 'string', description: 'An Orbit namespaced claim key.' },
          value: {
            description:
              'Typed immutable assertion value; semantics follow the registered claim key.',
          },
        },
      };
    if (name === 'IdentityAssertionCredential')
      return {
        title: name,
        description:
          'Orbit assertion credential carried as a W3C VC 2.0 JOSE vc+jwt. The holder is identified by the native profile URL. Issuance follows recipient acceptance; disclosure requires explicit selection of this credential.',
        type: 'object',
        required: [
          '@context',
          'id',
          'type',
          'issuer',
          'validFrom',
          'validUntil',
          'credentialSubject',
          'credentialStatus',
        ],
      };
    if (name === 'IdentityCredentialStatus')
      return {
        title: name,
        description:
          'Orbit live credential status. GET the credentialStatus.id URL. valid is false after credential, assertion, issuer or signing-key revocation. This is a custom live status method; it is not BitstringStatusList.',
        type: 'object',
        properties: { valid: { type: 'boolean' } },
      };
    throw new DomainError('NOT_FOUND', 'Schema unavailable.', 404);
  }
}
