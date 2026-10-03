import {
  S3Client,
  CreateBucketCommand,
  PutBucketCorsCommand,
  PutObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { randomUUID } from 'node:crypto';
const c = new S3Client({
  endpoint: process.env.S3_ENDPOINT,
  region: process.env.S3_REGION,
  forcePathStyle: true,
  maxAttempts: 2,
  requestHandler: {
    connectionTimeout: 3_000,
    requestTimeout: 15_000,
    socketTimeout: 15_000,
    throwOnRequestTimeout: true,
  },
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY,
    secretAccessKey: process.env.S3_SECRET_KEY,
  },
});
let ready = false;
for (let n = 0; n < 30; n++) {
  try {
    await c.send(new CreateBucketCommand({ Bucket: process.env.S3_BUCKET }));
    ready = true;
    break;
  } catch (e) {
    if (['BucketAlreadyOwnedByYou', 'BucketAlreadyExists'].includes(e.name)) {
      ready = true;
      break;
    }
    if (n === 29) throw e;
    await new Promise((r) => setTimeout(r, 2000));
  }
}
if (!ready) throw new Error('Object storage unavailable');
await c.send(
  new PutBucketCorsCommand({
    Bucket: process.env.S3_BUCKET,
    CORSConfiguration: {
      CORSRules: [
        {
          AllowedOrigins: [process.env.PUBLIC_ORIGIN],
          AllowedMethods: ['PUT'],
          AllowedHeaders: ['content-type', 'x-amz-*'],
          ExposeHeaders: ['ETag'],
          MaxAgeSeconds: 300,
        },
      ],
    },
  }),
);
const probeKey = 'health/storage-init-' + randomUUID();
try {
  await c.send(
    new PutObjectCommand({
      Bucket: process.env.S3_BUCKET,
      Key: probeKey,
      Body: 'private startup write probe',
      ContentType: 'text/plain',
    }),
  );
} finally {
  await c.send(new DeleteObjectCommand({ Bucket: process.env.S3_BUCKET, Key: probeKey }));
}
process.stdout.write('Private media bucket ready after a write/delete probe.\n');
