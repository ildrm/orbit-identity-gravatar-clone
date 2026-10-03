import 'reflect-metadata';
import { AppModule } from './app.module.js';
import { NestFactory } from '@nestjs/core';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import express from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { Registry, Counter, Histogram, collectDefaultMetrics } from 'prom-client';
import { config } from '../../../packages/core/src/config.js';
import { database, query, closeDatabase } from '../../../packages/core/src/db.js';
import { connectRedis, redis, rateLimit, closeRedis } from '../../../packages/core/src/redis.js';
import { AuthService } from './auth/auth.service.js';
import { IdentityService } from './identity/identity.service.js';
import { enrichOpenApi } from './openapi.js';
import { ErrorFilter, type ApiRequest } from './http.js';
const c = config();
await connectRedis();
const app = await NestFactory.create(AppModule, {
  bodyParser: false,
  logger: ['error', 'warn', 'log'],
});
app.enableShutdownHooks();
app.useGlobalFilters(new ErrorFilter());
const server = app.getHttpAdapter().getInstance() as express.Express;
server.set('trust proxy', c.TRUST_PROXY === 'true' ? 1 : false);
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use('/api/v1/identities', express.json({ limit: '2mb' }));
app.use(express.json({ limit: '64kb' }));
app.use(
  '/api/v1/oauth/token',
  express.urlencoded({ extended: false, limit: '8kb', parameterLimit: 12 }),
);
app.use(
  '/api/v1/oauth/revoke',
  express.urlencoded({ extended: false, limit: '8kb', parameterLimit: 6 }),
);
app.use(cookieParser());
const registry = new Registry();
collectDefaultMetrics({ register: registry });
const requests = new Counter({
  name: 'identity_http_requests_total',
  help: 'HTTP requests by status',
  labelNames: ['status'],
  registers: [registry],
});
const latency = new Histogram({
  name: 'identity_http_duration_seconds',
  help: 'Request duration',
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
  registers: [registry],
});
server.get('/health/live', (_req, res) => res.json({ status: 'live' }));
server.get('/health/ready', async (_req, res) => {
  try {
    await database().query('SELECT 1');
    await redis().ping();
    res.json({ status: 'ready' });
  } catch {
    res.status(503).json({ status: 'unavailable' });
  }
});
server.get('/metrics', async (_req, res) => {
  res.type(registry.contentType).send(await registry.metrics());
});
const auth = app.get(AuthService);
app.use(async (req: ApiRequest, res: express.Response, next: express.NextFunction) => {
  req.requestId = randomUUID();
  res.setHeader('X-Request-ID', req.requestId);
  res.setHeader('Cache-Control', 'no-store');
  const end = latency.startTimer();
  res.on('finish', () => {
    requests.inc({ status: String(res.statusCode) });
    end();
  });
  try {
    const origins = [c.PUBLIC_ORIGIN, c.ADMIN_ORIGIN].filter(Boolean);
    const trustedBrowserOrigin =
      typeof req.headers.origin === 'string' && origins.includes(req.headers.origin);
    const corsRead = ['GET', 'HEAD'].includes(req.method),
      corsToken = ['/api/v1/oauth/token', '/api/v1/oauth/revoke'].includes(req.path);
    if (trustedBrowserOrigin) {
      res.setHeader('Access-Control-Allow-Origin', req.headers.origin!);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.vary('Origin');
    } else if (corsRead || corsToken) {
      res.setHeader('Access-Control-Allow-Origin', '*');
    }
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.setHeader(
      'Access-Control-Allow-Methods',
      trustedBrowserOrigin
        ? 'GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS'
        : 'GET, HEAD, POST, OPTIONS',
    );
    res.setHeader(
      'Access-Control-Expose-Headers',
      'X-Request-ID, RateLimit-Limit, RateLimit-Remaining, Retry-After',
    );
    if (req.method === 'OPTIONS') {
      if (
        trustedBrowserOrigin ||
        corsToken ||
        req.headers['access-control-request-method'] === 'GET'
      ) {
        if (!trustedBrowserOrigin) res.setHeader('Access-Control-Allow-Origin', '*');
        return res.status(204).end();
      }
      return res.status(403).end();
    }
    if (
      req.method === 'POST' &&
      /^\/api\/v1\/profiles\/idn_[a-f0-9]{32}\/activity$/.test(req.path) &&
      !req.headers.cookie &&
      !req.headers.authorization &&
      typeof req.headers.origin === 'string'
    ) {
      let origin: URL | undefined;
      try {
        origin = new URL(req.headers.origin);
      } catch {}
      if (
        origin?.protocol === 'https:' &&
        origin.origin === req.headers.origin &&
        (
          await query(
            "SELECT 1 FROM domains d JOIN identities i ON i.id=d.identity_id WHERE d.domain=$1 AND d.identity_id=$2 AND d.revoked_at IS NULL AND d.verified_at IS NOT NULL AND d.last_checked_at>now()-interval '26 hours' AND d.expires_at>now() AND d.custom_enabled AND d.routing_state='ACTIVE' AND i.state='ACTIVE' AND i.visibility='PUBLIC' AND i.analytics_enabled",
            [origin.hostname, req.path.split('/')[4]],
          )
        ).length
      )
        origins.push(req.headers.origin);
    }
    const federationEndpoint =
      req.path === '/api/v1/federation/inbox' &&
      req.method === 'POST' &&
      req.is('application/json');
    const oauthMachineEndpoint =
      ['/api/v1/oauth/token', '/api/v1/oauth/revoke'].includes(req.path) &&
      req.method === 'POST' &&
      req.is('application/x-www-form-urlencoded');
    if (
      !['GET', 'HEAD', 'OPTIONS'].includes(req.method) &&
      !origins.includes(req.headers.origin) &&
      !oauthMachineEndpoint &&
      !federationEndpoint
    )
      return res.status(403).json({
        code: 'ORIGIN_DENIED',
        message: 'Use the trusted application origin.',
        status: 403,
        request_id: req.requestId,
      });
    const sensitive = /\/auth\/(login|register|recover|reset|stepup|passkeys\/authentication)/.test(
      req.path,
    );
    const limiter = await rateLimit(
      (sensitive ? 'auth:' : 'api:') + (req.ip ?? 'unknown'),
      sensitive ? 20 : 300,
      sensitive ? 300 : 60,
    );
    res.setHeader('RateLimit-Limit', sensitive ? 20 : 300);
    res.setHeader('RateLimit-Remaining', limiter.remaining);
    if (!limiter.allowed) {
      res.setHeader('Retry-After', sensitive ? 300 : 60);
      return res.status(429).json({
        code: 'RATE_LIMITED',
        message: 'Too many requests. Try again shortly.',
        status: 429,
        request_id: req.requestId,
      });
    }
    req.account =
      oauthMachineEndpoint || federationEndpoint ? undefined : await auth.authenticate(req);
    next();
  } catch (error) {
    next(error);
  }
});
server.get('/internal/profiles/:id', async (req, res, next) => {
  try {
    const key = req.headers['x-internal-api-key'];
    const expected = Buffer.from(c.INTERNAL_API_KEY);
    if (
      typeof key !== 'string' ||
      Buffer.byteLength(key) !== expected.length ||
      !timingSafeEqual(Buffer.from(key), expected)
    )
      return res.sendStatus(404);
    const profile = await app
      .get(IdentityService)
      .profile(
        String(req.params.id),
        typeof req.query.persona === 'string' ? req.query.persona : null,
        'human',
        (req as express.Request & Pick<ApiRequest, 'account'>).account
          ? { accountId: (req as express.Request & Pick<ApiRequest, 'account'>).account!.id }
          : {},
      );
    res.setHeader('Cache-Control', 'no-store');
    res.json(profile);
  } catch (error) {
    next(error);
  }
});
const spec = SwaggerModule.createDocument(
  app,
  new DocumentBuilder()
    .setTitle('Identity Platform API')
    .setDescription(
      'Privacy-first identities, native credentials, and OAuth authorization-code grants with S256 PKCE.',
    )
    .setVersion('1.0.0')
    .addCookieAuth('identity_session')
    .addBearerAuth()
    .build(),
);
server.get('/api/v1/openapi.json', (_req, res) => res.json(enrichOpenApi(spec)));
await app.listen(c.PORT, '0.0.0.0');
process.on('SIGTERM', () => {
  void Promise.all([closeDatabase(), closeRedis()]);
});
