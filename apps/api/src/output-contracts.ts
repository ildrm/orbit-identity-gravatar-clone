import type { OpenAPIObject, SchemaObject } from '@nestjs/swagger';

export function documentOutputContracts(spec: OpenAPIObject): void {
  const schemas = spec.components!.schemas!;
  const text: SchemaObject = { type: 'string' },
    boolean: SchemaObject = { type: 'boolean' };
  schemas.PublicClaim = {
    type: 'object',
    required: ['id', 'key', 'value', 'locale', 'source', 'verification', 'freshness', 'updatedAt'],
    properties: {
      id: text,
      key: text,
      value: {},
      locale: text,
      source: text,
      verification: text,
      freshness: text,
      updatedAt: { type: 'string', format: 'date-time' },
    },
  };
  schemas.PublicProfile = {
    type: 'object',
    required: [
      'id',
      'handle',
      'type',
      'persona',
      'displayName',
      'claims',
      'avatarUrl',
      'contactEnabled',
      'visibility',
      'indexable',
      'machine',
      'agent',
      'theme',
      'locale',
    ],
    properties: {
      id: text,
      handle: text,
      type: text,
      persona: { type: 'string', nullable: true },
      displayName: text,
      claims: { type: 'array', items: { $ref: '#/components/schemas/PublicClaim' } },
      blocks: {
        type: 'array',
        items: {
          type: 'object',
          required: ['id', 'kind', 'title', 'locale', 'configuration'],
          properties: {
            id: text,
            kind: text,
            title: text,
            locale: text,
            configuration: {
              type: 'object',
              properties: {
                text,
                url: text,
                items: {
                  type: 'array',
                  items: {
                    type: 'object',
                    required: ['label', 'url'],
                    properties: { label: text, url: text, description: text },
                  },
                },
                mediaIds: { type: 'array', items: text },
              },
            },
          },
        },
      },
      avatarUrl: text,
      headerUrl: text,
      contactEnabled: boolean,
      visibility: text,
      indexable: boolean,
      machine: boolean,
      agent: boolean,
      theme: text,
      locale: text,
    },
  };
  schemas.SearchPage = {
    type: 'object',
    required: ['items', 'nextCursor'],
    properties: {
      items: {
        type: 'array',
        items: {
          type: 'object',
          required: ['id', 'handle', 'type', 'display_name'],
          properties: { id: text, handle: text, type: text, display_name: text },
        },
      },
      nextCursor: { type: 'string', nullable: true },
    },
  };
  schemas.OAuthToken = {
    type: 'object',
    required: ['access_token', 'token_type', 'expires_in', 'scope'],
    properties: {
      access_token: text,
      token_type: { type: 'string', enum: ['Bearer'] },
      expires_in: { type: 'integer', minimum: 1, maximum: 900 },
      refresh_token: { type: 'string', nullable: true },
      scope: text,
    },
  };
  schemas.OAuthError = {
    type: 'object',
    required: ['error'],
    properties: { error: text, error_description: text },
  };
  const profilePaths = [
    '/api/v1/profiles/{identifier}',
    '/api/v1/application/profile',
    '/api/v1/oauth/profile',
  ];
  for (const path of profilePaths) {
    const operation = spec.paths[path]?.get;
    if (operation)
      operation.responses['200'] = {
        description:
          'Current policy projection. Field, scope, persona, state and channel permissions apply on every read.',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/PublicProfile' } } },
      };
  }
  const search = spec.paths['/api/v1/search']?.get;
  if (search) {
    search.responses['200'] = {
      description: 'Bounded permitted search results and opaque identity cursor.',
      content: { 'application/json': { schema: { $ref: '#/components/schemas/SearchPage' } } },
    };
    search.parameters = [
      {
        name: 'q',
        in: 'query',
        required: true,
        schema: { type: 'string', minLength: 2, maxLength: 80 },
      },
      {
        name: 'limit',
        in: 'query',
        required: false,
        schema: { type: 'integer', minimum: 1, maximum: 50, default: 20 },
      },
      { name: 'cursor', in: 'query', required: false, schema: text },
    ];
  }
  const resolver = spec.paths['/api/v1/resolve']?.get;
  if (resolver) {
    resolver.parameters = [
      {
        name: 'type',
        in: 'query',
        required: true,
        schema: { type: 'string', enum: ['native', 'domain', 'email', 'github', 'did'] },
      },
      {
        name: 'identifier',
        in: 'query',
        required: true,
        schema: { type: 'string', minLength: 1, maxLength: 1000 },
      },
    ];
    resolver.responses['200'] = {
      description:
        'Permitted resolved profile and provenance; email adapter requires the same verified account.',
      content: {
        'application/json': {
          schema: {
            type: 'object',
            required: ['profile', 'resolution'],
            properties: {
              profile: { $ref: '#/components/schemas/PublicProfile' },
              resolution: {
                type: 'object',
                required: ['adapter', 'provenance', 'fallback', 'cache', 'externalFetch'],
                properties: {
                  adapter: text,
                  provenance: text,
                  fallback: text,
                  cache: { type: 'string', enum: ['no-store'] },
                  externalFetch: boolean,
                },
              },
            },
          },
        },
      },
    };
  }
  const profile = spec.paths['/api/v1/profiles/{identifier}']?.get;
  if (profile)
    profile.parameters = [
      { name: 'identifier', in: 'path', required: true, schema: text },
      { name: 'persona', in: 'query', required: false, schema: text },
      {
        name: 'channel',
        in: 'query',
        required: false,
        schema: { type: 'string', enum: ['api', 'machine', 'agent', 'index'], default: 'api' },
      },
    ];
  for (const path of ['/api/v1/oauth/token', '/api/v1/oauth/revoke']) {
    const operation = spec.paths[path]?.post;
    if (operation)
      for (const code of ['400', '401'])
        operation.responses[code] = {
          description:
            'OAuth protocol error; invalid clients receive HTTP 401 and the Basic challenge.',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/OAuthError' } } },
        };
  }
  const token = spec.paths['/api/v1/oauth/token']?.post;
  if (token)
    token.responses['200'] = {
      description:
        'Opaque short-lived access token and rotating refresh token. Store tokens privately.',
      content: { 'application/json': { schema: { $ref: '#/components/schemas/OAuthToken' } } },
    };
}
