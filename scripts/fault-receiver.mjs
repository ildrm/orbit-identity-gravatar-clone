import { createServer } from 'node:https';
import { readFileSync, appendFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHmac, timingSafeEqual } from 'node:crypto';
const root = '/fixture',
  applied = new Set();
createServer(
  { key: readFileSync(root + '/key.pem'), cert: readFileSync(root + '/cert.pem') },
  (req, res) => {
    if (req.method === 'HEAD') {
      res.writeHead(200);
      res.end();
      return;
    }
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 262144) req.destroy();
    });
    req.on('end', () => {
      if (req.method !== 'POST') {
        res.writeHead(404);
        res.end();
        return;
      }
      const timestamp = String(req.headers['x-identity-timestamp'] ?? ''),
        signature = String(req.headers['x-identity-signature'] ?? ''),
        secret = existsSync(root + '/secret.txt')
          ? readFileSync(root + '/secret.txt', 'utf8')
          : 'missing',
        expected = createHmac('sha256', secret)
          .update(timestamp + '.' + body)
          .digest('hex'),
        signatureValid =
          signature.length === expected.length &&
          timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
      const mode = readFileSync(root + '/mode.txt', 'utf8').trim(),
        status = mode === 'hold' ? 0 : mode === 'fail' ? 503 : signatureValid ? 204 : 401;
      let event;
      try {
        event = JSON.parse(body);
      } catch {
        event = { invalid: true };
      }
      const delivery = String(req.headers['x-identity-delivery']),
        sideEffectApplied = status === 204 && !applied.has(delivery);
      if (sideEffectApplied) applied.add(delivery);
      appendFileSync(
        root + '/received.ndjson',
        JSON.stringify({
          timestamp,
          delivery,
          signatureValid,
          event,
          status,
          sideEffectApplied,
          receivedAt: Date.now(),
        }) + '\n',
      );
      if (mode === 'hold') return;
      res.writeHead(status);
      res.end();
    });
  },
).listen(443, '0.0.0.0', () => writeFileSync(root + '/ready', 'ready'));
