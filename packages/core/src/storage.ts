import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createReadStream } from 'node:fs';
import { config } from './config.js';
let internal: S3Client | undefined;
export function storage(): S3Client {
  const c = config();
  return (internal ??= new S3Client({
    endpoint: c.S3_ENDPOINT,
    region: c.S3_REGION,
    forcePathStyle: true,
    maxAttempts: 2,
    requestHandler: {
      connectionTimeout: 3_000,
      requestTimeout: 15_000,
      socketTimeout: 15_000,
      throwOnRequestTimeout: true,
    },
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
    credentials: { accessKeyId: c.S3_ACCESS_KEY, secretAccessKey: c.S3_SECRET_KEY },
  }));
}
function publicStorage(): S3Client {
  const c = config();
  return new S3Client({
    endpoint: c.S3_PUBLIC_ENDPOINT ?? c.S3_ENDPOINT,
    region: c.S3_REGION,
    forcePathStyle: true,
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
    credentials: { accessKeyId: c.S3_ACCESS_KEY, secretAccessKey: c.S3_SECRET_KEY },
  });
}
export async function putObject(key: string, body: Buffer | string, contentType: string) {
  await storage().send(
    new PutObjectCommand({
      Bucket: config().S3_BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  );
}
export async function putObjectFile(key: string, path: string, bytes: number, contentType: string) {
  await storage().send(
    new PutObjectCommand({
      Bucket: config().S3_BUCKET,
      Key: key,
      Body: createReadStream(path),
      ContentLength: bytes,
      ContentType: contentType,
    }),
  );
}
export async function getObject(key: string, maxBytes = 10 * 1024 * 1024): Promise<Buffer> {
  const response = await storage().send(
    new GetObjectCommand({ Bucket: config().S3_BUCKET, Key: key }),
  );
  if (!response.Body || Number(response.ContentLength) > maxBytes)
    throw new Error('Storage object exceeds limit');
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of response.Body as AsyncIterable<Uint8Array>) {
    total += chunk.length;
    if (total > maxBytes) throw new Error('Storage object exceeds limit');
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}
export async function uploadUrl(key: string, bytes: number) {
  return getSignedUrl(
    publicStorage(),
    new PutObjectCommand({
      Bucket: config().S3_BUCKET,
      Key: key,
      ContentType: 'application/octet-stream',
      ContentLength: bytes,
    }),
    { expiresIn: 300 },
  );
}
export async function downloadUrl(key: string) {
  return getSignedUrl(
    publicStorage(),
    new GetObjectCommand({
      Bucket: config().S3_BUCKET,
      Key: key,
      ResponseContentDisposition: 'attachment',
    }),
    { expiresIn: 60 },
  );
}
export async function deleteObject(key: string) {
  await storage().send(new DeleteObjectCommand({ Bucket: config().S3_BUCKET, Key: key }));
}
export async function objectExists(key: string) {
  return storage().send(new HeadObjectCommand({ Bucket: config().S3_BUCKET, Key: key }));
}
