import express from 'express';
import { operationalMetrics } from '../../../packages/core/src/operational-metrics.js';
import { deliveryCacheStats } from '../../../packages/core/src/delivery-cache.js';
import { Counter, Histogram, Gauge } from 'prom-client';
import { recordAggregate } from '../../../packages/core/src/analytics.js';
import helmet from 'helmet';
import sharp from 'sharp';
import { createHash } from 'node:crypto';
import { config } from '../../../packages/core/src/config.js';
import { closeDatabase } from '../../../packages/core/src/db.js';
import { redis, connectRedis, rateLimit, closeRedis } from '../../../packages/core/src/redis.js';
import { generatedAvatar, type AvatarStyle } from '../../../packages/core/src/avatar.js';
import {
  avatarProjection,
  assetProjection,
} from '../../../packages/core/src/delivery-projection.js';
import { getObject } from '../../../packages/core/src/storage.js';
const c = config();
await connectRedis();
const app = express();
const registry = operationalMetrics(app, 'delivery', () => Date.now());
new Gauge({
  name: 'identity_delivery_projection_count',
  help: 'Projection cache outcomes since process start',
  labelNames: ['outcome'],
  registers: [registry],
  collect() {
    for (const [outcome, value] of Object.entries(deliveryCacheStats)) this.set({ outcome }, value);
  },
});
const requests = new Counter({
  name: 'identity_delivery_requests_total',
  help: 'Delivery requests by operation and HTTP status',
  labelNames: ['operation', 'status'],
  registers: [registry],
});
const latency = new Histogram({
  name: 'identity_delivery_duration_seconds',
  help: 'Delivery request duration',
  labelNames: ['operation'],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1],
  registers: [registry],
});
app.use((req, res, next) => {
  if (req.path.startsWith('/avatar/') || req.path.startsWith('/assets/')) {
    const operation = req.path.startsWith('/avatar/') ? 'avatar' : 'asset',
      end = latency.startTimer({ operation });
    res.on('finish', () => {
      requests.inc({ operation, status: String(res.statusCode) });
      end();
    });
  }
  next();
});
app.set('trust proxy', c.TRUST_PROXY === 'true' ? 1 : false);
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: { defaultSrc: ["'none'"], styleSrc: ["'none'"], sandbox: [] },
    },
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  }),
);
app.get('/health', (_req, res) => res.json({ status: 'ready' }));
app.get('/avatar/:identifier', async (req, res) => {
  try {
    const rate = await rateLimit('avatar:' + (req.ip ?? 'unknown'), 300, 60);
    if (!rate.allowed) return res.sendStatus(429);
    const identifier = String(req.params.identifier);
    if (!/^[a-zA-Z0-9_@-]{3,100}$/.test(identifier)) return res.sendStatus(400);
    const size = Number(req.query.size ?? req.query.s ?? 128);
    if (!Number.isInteger(size) || size < 16 || size > 1024) return res.sendStatus(400);
    let style = String(req.query.default ?? 'geometric');
    if (!['geometric', 'initials', 'rings', '404'].includes(style)) return res.sendStatus(400);
    const rating = String(req.query.rating ?? 'g');
    if (!['g', 'pg', 'r', 'x'].includes(rating)) return res.sendStatus(400);
    const {
      identity: i,
      mediaId,
      variants,
    } = await avatarProjection(
      identifier,
      typeof req.query.persona === 'string' ? req.query.persona : null,
      typeof req.query.application === 'string' ? req.query.application : null,
      typeof req.query.domain === 'string' ? req.query.domain : null,
    );
    if (req.query.default === undefined && i) style = i.avatar_style;
    if (i?.analytics_enabled)
      await recordAggregate(
        i.id,
        'avatar_request',
        req.headers.dnt === '1' || req.headers['sec-gpc'] === '1',
      );
    if (i && mediaId) {
      const format = String(req.query.format ?? 'webp');
      if (!['webp', 'jpeg', 'png', 'avif'].includes(format)) return res.sendStatus(400);
      const width = [64, 128, 256, 512, 1024].find((v) => v >= size) ?? 1024,
        key = variants[format === 'webp' ? String(width) : width + '.' + format];
      if (key) {
        res.setHeader('Cache-Control', 'no-store');
        return res.redirect(302, '/assets/' + mediaId + '/' + width + '.' + format);
      }
    }
    if (style === '404') return res.sendStatus(404);
    const format = String(req.query.format ?? 'svg');
    if (!['svg', 'png', 'webp', 'avif', 'jpeg'].includes(format)) return res.sendStatus(400);
    const seed =
      i && i.visibility !== 'PRIVATE' && ['ACTIVE', 'MEMORIALIZED', 'FROZEN'].includes(i.state)
        ? i.id
        : identifier;
    const svg = generatedAvatar(
      seed,
      size,
      style as AvatarStyle,
      i && i.visibility !== 'PRIVATE' && ['ACTIVE', 'MEMORIALIZED', 'FROZEN'].includes(i.state)
        ? i.avatar_color
        : undefined,
    );
    const key =
      'generated:' +
      createHash('sha256')
        .update(svg + format)
        .digest('hex');
    let body = await redis().getBuffer(key);
    if (!body) {
      body =
        format === 'svg'
          ? Buffer.from(svg)
          : await sharp(Buffer.from(svg))
              .toFormat(format as 'png' | 'webp' | 'avif' | 'jpeg')
              .toBuffer();
      await redis().set(key, body, 'EX', 3600);
    }
    const etag = '"' + createHash('sha256').update(body).digest('hex') + '"';
    res.setHeader('ETag', etag);
    res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=30');
    if (req.headers['if-none-match'] === etag) return res.sendStatus(304);
    res.type(format === 'svg' ? 'image/svg+xml' : 'image/' + format).send(body);
  } catch (error) {
    process.stderr.write(
      JSON.stringify({
        level: 'error',
        code: 'DELIVERY_ERROR',
        name: error instanceof Error ? error.name : 'UnknownError',
      }) + '\n',
    );
    res.sendStatus(503);
  }
});
app.get('/assets/:media/:variant', async (req, res) => {
  try {
    const media = String(req.params.media),
      variant = String(req.params.variant);
    if (
      !/^med_[a-f0-9]{32}$/.test(media) ||
      !/^(64|128|256|512|1024)\.(webp|png|jpeg|avif)$/.test(variant)
    )
      return res.sendStatus(404);
    const width = variant.split('.')[0]!;
    const variants = await assetProjection(media);
    const format = variant.split('.')[1]!,
      key = variants[format === 'webp' ? width : variant];
    if (!key) return res.sendStatus(404);
    const cacheKey = 'asset:' + media + ':' + variant;
    let body = await redis().getBuffer(cacheKey);
    if (!body) {
      body = await getObject(key, 2 * 1024 * 1024);
      await redis().set(cacheKey, body, 'EX', 3600);
    }
    const etag = '"' + createHash('sha256').update(body).digest('hex') + '"';
    res.setHeader('ETag', etag);
    res.setHeader('Cache-Control', 'no-store');
    if (req.headers['if-none-match'] === etag) return res.sendStatus(304);
    res.type('image/' + format).send(body);
  } catch {
    res.sendStatus(503);
  }
});
const server = app.listen(c.DELIVERY_PORT, '0.0.0.0');
process.on('SIGTERM', () => {
  server.close();
  void Promise.all([closeDatabase(), closeRedis()]);
});
