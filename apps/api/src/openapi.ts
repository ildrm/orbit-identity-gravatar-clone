import { z } from 'zod';
import { documentOutputContracts } from './output-contracts.js';
import type { OpenAPIObject, SchemaObject } from '@nestjs/swagger';
import {
  registerSchema,
  loginSchema,
  identitySchema,
  claimSchema,
  claimValues,
  personaSchema,
  profileSettingsSchema,
  applicationSchema,
  consentSchema,
  relationshipSchema,
  webhookSchema,
} from '../../../packages/contracts/src/index.js';
const bodies: { path: string; method: 'post' | 'put'; name: string; schema: z.ZodType }[] = [
  { path: '/api/v1/auth/register', method: 'post', name: 'RegisterInput', schema: registerSchema },
  { path: '/api/v1/auth/login', method: 'post', name: 'LoginInput', schema: loginSchema },
  { path: '/api/v1/identities', method: 'post', name: 'IdentityInput', schema: identitySchema },
  {
    path: '/api/v1/identities/{id}/claims',
    method: 'put',
    name: 'ClaimInput',
    schema: claimSchema,
  },
  {
    path: '/api/v1/identities/{id}/personas',
    method: 'post',
    name: 'PersonaInput',
    schema: personaSchema,
  },
  {
    path: '/api/v1/identities/{id}/settings',
    method: 'put',
    name: 'PrivacyInput',
    schema: profileSettingsSchema,
  },
  {
    path: '/api/v1/applications',
    method: 'post',
    name: 'ApplicationInput',
    schema: applicationSchema,
  },
  {
    path: '/api/v1/identities/{id}/consents',
    method: 'post',
    name: 'ConsentInput',
    schema: consentSchema,
  },
  {
    path: '/api/v1/identities/{id}/relationships',
    method: 'post',
    name: 'RelationshipInput',
    schema: relationshipSchema,
  },
  {
    path: '/api/v1/applications/{id}/webhooks',
    method: 'post',
    name: 'WebhookInput',
    schema: webhookSchema,
  },
];
export function enrichOpenApi(spec: OpenAPIObject): OpenAPIObject {
  spec.components ??= {};
  spec.components.schemas ??= {};
  spec.components.securitySchemes = {
    cookie: { type: 'apiKey', in: 'cookie', name: 'identity_session' },
    bearer: {
      type: 'http',
      scheme: 'bearer',
      description: 'Native ik_ application or ic_ consent credential.',
    },
    OAuthBearer: {
      type: 'http',
      scheme: 'bearer',
      description:
        'Opaque oa_ OAuth access token; exact scopes, fields and current holder ownership apply.',
    },
    OAuthBasic: {
      type: 'http',
      scheme: 'basic',
      description:
        'Confidential OAuth client authentication. Public clients send client_id without Basic authentication.',
    },
  };
  spec.components.schemas.ApiError = {
    type: 'object',
    required: ['code', 'message', 'status', 'request_id'],
    properties: {
      code: { type: 'string' },
      message: { type: 'string' },
      status: { type: 'integer' },
      request_id: { type: 'string' },
      details: { type: 'array', items: { type: 'object' } },
    },
  };
  for (const body of bodies) {
    spec.components.schemas[body.name] = z.toJSONSchema(body.schema, {
      target: 'openapi-3.0',
      io: 'input',
      unrepresentable: 'any',
    }) as SchemaObject;
    const operation = spec.paths[body.path]?.[body.method];
    if (operation)
      operation.requestBody = {
        required: true,
        content: { 'application/json': { schema: { $ref: '#/components/schemas/' + body.name } } },
      };
  }
  const claim = spec.components.schemas.ClaimInput as SchemaObject;
  claim.oneOf = Object.entries(claimValues).map(([key, value]) => ({
    type: 'object',
    required: ['key', 'value'],
    properties: {
      key: { type: 'string', enum: [key] },
      value: z.toJSONSchema(value, {
        target: 'openapi-3.0',
        io: 'input',
        unrepresentable: 'any',
      }) as SchemaObject,
    },
  }));
  for (const [path, item] of Object.entries(spec.paths)) {
    for (const method of ['get', 'post', 'put', 'delete', 'patch'] as const) {
      const operation = item?.[method];
      if (!operation) continue;
      const anonymous =
        path.startsWith('/api/v1/profiles/') ||
        path.startsWith('/api/v1/search') ||
        path === '/api/v1/features' ||
        (path === '/api/v1/schemas' && method === 'get') ||
        path.startsWith('/q/') ||
        path.startsWith('/schemas/') ||
        path.startsWith('/api/v1/dids/') ||
        path === '/api/v1/federation/inbox' ||
        path === '/api/v1/federation/resolve' ||
        path === '/api/v1/resolve' ||
        /^\/api\/v1\/credentials\/[^/]+\/status$/.test(path) ||
        path.startsWith('/.well-known/') ||
        /^\/api\/v1\/auth\/(register|verify|login|recover|reset|passkeys\/authentication)/.test(
          path,
        );
      operation.security = anonymous
        ? []
        : path.startsWith('/api/v1/application') && !path.startsWith('/api/v1/applications')
          ? [{ bearer: [] }]
          : ['/api/v1/oauth/profile', '/api/v1/oauth/credentials', '/api/v1/oauth/avatar'].includes(
                path,
              )
            ? [{ OAuthBearer: [] }]
            : ['/api/v1/oauth/token', '/api/v1/oauth/revoke'].includes(path)
              ? [{ OAuthBasic: [] }, {}]
              : [{ cookie: [] }];
      if (path.includes('/internal/'))
        operation.description =
          'Private network only. Internal service authorization is required; public edge returns 404.';
      if (['/api/v1/oauth/token', '/api/v1/oauth/revoke'].includes(path)) {
        operation.requestBody = {
          required: true,
          content: {
            'application/x-www-form-urlencoded': {
              schema: {
                type: 'object',
                additionalProperties: false,
                required: path.endsWith('/token') ? ['grant_type'] : ['token'],
                properties: path.endsWith('/token')
                  ? {
                      grant_type: { type: 'string', enum: ['authorization_code', 'refresh_token'] },
                      client_id: { type: 'string' },
                      code: { type: 'string' },
                      redirect_uri: { type: 'string' },
                      code_verifier: { type: 'string', minLength: 43, maxLength: 128 },
                      refresh_token: { type: 'string' },
                      scope: { type: 'string' },
                    }
                  : {
                      client_id: { type: 'string' },
                      token: { type: 'string' },
                      token_type_hint: { type: 'string', enum: ['access_token', 'refresh_token'] },
                    },
              },
            },
          },
        };
        operation.description =
          'Strict single-valued form parameters. Confidential clients authenticate with HTTP Basic. Public clients send client_id. JSON and duplicate parameters are rejected.';
      }
      if (path === '/api/v1/federation/inbox')
        operation.description =
          'Orbit federation v1: signed EdDSA JOSE activity from an explicitly approved fingerprint-pinned peer. Cookie authentication is not used.';
      for (const code of ['400', '401', '403', '404', '409', '429', '503'])
        operation.responses[code] = {
          description: 'Standard error; preserve request_id for support.',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiError' } } },
        };
    }
  }
  documentOutputContracts(spec);
  return spec;
}
