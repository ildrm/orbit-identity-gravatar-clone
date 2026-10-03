import { randomBytes } from 'node:crypto';
import { existsSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
const key = () => randomBytes(24).toString('hex');
if (!existsSync('.env')) {
  const pg = key(),
    redis = key(),
    s3 = key();
  writeFileSync(
    '.env',
    [
      'POSTGRES_PASSWORD=' + pg,
      'REDIS_PASSWORD=' + redis,
      'DATABASE_URL=postgresql://identity:' + pg + '@localhost:5432/identity',
      'REDIS_URL=redis://:' + redis + '@localhost:6379',
      'PUBLIC_ORIGIN=http://localhost:8080',
      'ADMIN_ORIGIN=http://localhost:8081',
      'S3_ENDPOINT=http://localhost:9000',
      'S3_PUBLIC_ENDPOINT=http://localhost:9000',
      'S3_REGION=us-east-1',
      'S3_BUCKET=identity-media',
      'S3_ACCESS_KEY=identity-local',
      'S3_SECRET_KEY=' + s3,
      'ENCRYPTION_KEY=' + randomBytes(32).toString('hex'),
      'INTERNAL_API_KEY=' + randomBytes(32).toString('hex'),
      'SMTP_HOST=localhost',
      'SMTP_PORT=1025',
      'EMAIL_FROM=identity@example.test',
      'RP_ID=localhost',
      'MODERATOR_EMAILS=',
      'NODE_ENV=development',
    ].join('\n') + '\n',
    { mode: 0o600 },
  );
  process.stdout.write('Created unique local configuration.\n');
} else process.stdout.write('Preserved existing .env.\n');
const env = readFileSync('.env', 'utf8'),
  vars = Object.fromEntries(
    env
      .trim()
      .split('\n')
      .map((l) => {
        const i = l.indexOf('=');
        return [l.slice(0, i), l.slice(i + 1).trim()];
      }),
  );
if (!vars.INTERNAL_API_KEY) {
  vars.INTERNAL_API_KEY = randomBytes(32).toString('hex');
  writeFileSync('.env', env + 'INTERNAL_API_KEY=' + vars.INTERNAL_API_KEY + '\n');
}
mkdirSync('data', { recursive: true });
writeFileSync(
  'data/s3.json',
  JSON.stringify({
    identities: [
      {
        name: 'identity',
        credentials: [{ accessKey: vars.S3_ACCESS_KEY, secretKey: vars.S3_SECRET_KEY }],
        actions: ['Admin', 'Read', 'Write', 'List', 'Tagging'],
      },
    ],
  }),
  { mode: 0o600 },
);
