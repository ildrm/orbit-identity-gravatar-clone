import sharp from 'sharp';
import { z } from 'zod';
export const imageTransforms = z
  .object({
    rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]).default(0),
    crop: z
      .object({
        x: z.number().min(0).max(1),
        y: z.number().min(0).max(1),
        width: z.number().positive().max(1),
        height: z.number().positive().max(1),
      })
      .strict()
      .refine((c) => c.x + c.width <= 1 && c.y + c.height <= 1, 'Crop must fit inside the image')
      .optional(),
    focal: z
      .object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) })
      .strict()
      .optional(),
    background: z
      .string()
      .regex(/^#[a-f0-9]{6}$/i)
      .optional(),
    removeColor: z
      .string()
      .regex(/^#[a-f0-9]{6}$/i)
      .optional(),
    tolerance: z.number().int().min(0).max(100).default(24),
    quality: z.number().int().min(60).max(95).default(85),
  })
  .strict();
export type ImageTransforms = z.infer<typeof imageTransforms>;
export async function transformImage(input: Buffer, value: unknown): Promise<Buffer> {
  const d = imageTransforms.parse(value),
    initial = await sharp(input, { limitInputPixels: 40_000_000, failOn: 'warning' })
      .rotate()
      .png()
      .toBuffer();
  const meta = await sharp(initial).metadata();
  let pipeline = sharp(initial);
  if (d.crop) {
    const left = Math.min(meta.width! - 1, Math.floor(d.crop.x * meta.width!)),
      top = Math.min(meta.height! - 1, Math.floor(d.crop.y * meta.height!));
    pipeline = pipeline.extract({
      left,
      top,
      width: Math.min(meta.width! - left, Math.max(1, Math.floor(d.crop.width * meta.width!))),
      height: Math.min(meta.height! - top, Math.max(1, Math.floor(d.crop.height * meta.height!))),
    });
  }
  // Raster normalization bounds memory before optional color removal.
  const cropped = await pipeline.png().toBuffer();
  const normalized = await sharp(cropped)
    .rotate(d.rotation)
    .resize(2048, 2048, { fit: 'inside', withoutEnlargement: true })
    .png()
    .toBuffer();
  let result = sharp(normalized);
  if (d.removeColor) {
    const { data, info } = await result.ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
      rgb = [1, 3, 5].map((x) => parseInt(d.removeColor!.slice(x, x + 2), 16));
    for (let x = 0; x < data.length; x += 4) {
      const distance = Math.sqrt(
        (data[x]! - rgb[0]!) ** 2 + (data[x + 1]! - rgb[1]!) ** 2 + (data[x + 2]! - rgb[2]!) ** 2,
      );
      if (distance <= d.tolerance) data[x + 3] = 0;
    }
    result = sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } });
  }
  if (d.background) result = result.flatten({ background: d.background });
  return result.png().toBuffer();
}
export async function imageVariant(
  input: Buffer,
  size: number,
  purpose: string,
  value: unknown,
  format: 'webp' | 'jpeg' | 'png' | 'avif' = 'webp',
): Promise<Buffer> {
  const d = imageTransforms.parse(value),
    meta = await sharp(input).metadata();
  let pipeline = sharp(input);
  if (purpose === 'AVATAR' || purpose === 'BRANDING') {
    const side = Math.min(meta.width!, meta.height!),
      left = Math.max(
        0,
        Math.min(meta.width! - side, Math.round((d.focal?.x ?? 0.5) * meta.width! - side / 2)),
      ),
      top = Math.max(
        0,
        Math.min(meta.height! - side, Math.round((d.focal?.y ?? 0.5) * meta.height! - side / 2)),
      );
    pipeline = pipeline.extract({ left, top, width: side, height: side }).resize(size, size);
  } else if (purpose === 'HEADER')
    pipeline = pipeline.resize(size, Math.round(size / 3), { fit: 'cover' });
  else pipeline = pipeline.resize(size, size, { fit: 'inside', withoutEnlargement: true });
  return format === 'png'
    ? pipeline.png().toBuffer()
    : format === 'jpeg'
      ? pipeline
          .flatten({ background: d.background ?? '#ffffff' })
          .jpeg({ quality: d.quality })
          .toBuffer()
      : format === 'avif'
        ? pipeline.avif({ quality: d.quality, effort: 2 }).toBuffer()
        : pipeline.webp({ quality: d.quality }).toBuffer();
}
