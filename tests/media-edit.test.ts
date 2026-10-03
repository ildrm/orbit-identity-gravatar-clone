import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { imageTransforms, transformImage, imageVariant } from '../packages/core/src/media-edit.js';
describe('normalized image editing', () => {
  it('rotates, crops, strips metadata and creates purpose-specific dimensions', async () => {
    const input = await sharp({
      create: { width: 120, height: 80, channels: 4, background: '#ff0000' },
    })
      .png()
      .toBuffer();
    const result = await transformImage(input, {
      crop: { x: 0, y: 0, width: 0.5, height: 1 },
      rotation: 90,
    });
    const m = await sharp(result).metadata();
    expect([m.width, m.height]).toEqual([80, 60]);
    expect(m.exif).toBeUndefined();
    expect((await sharp(await imageVariant(result, 128, 'HEADER', {})).metadata()).height).toBe(43);
    expect((await sharp(await imageVariant(result, 128, 'AVATAR', {})).metadata()).height).toBe(
      128,
    );
  });
  it('removes a selected solid color and fills it with the explicit replacement', async () => {
    const input = await sharp({
      create: { width: 16, height: 16, channels: 4, background: '#ffffff' },
    })
      .png()
      .toBuffer();
    const transparent = await sharp(await transformImage(input, { removeColor: '#ffffff' }))
      .ensureAlpha()
      .raw()
      .toBuffer();
    expect(transparent[3]).toBe(0);
    const filled = await sharp(
      await transformImage(input, { removeColor: '#ffffff', background: '#123456' }),
    )
      .raw()
      .toBuffer();
    expect([...filled.subarray(0, 3)]).toEqual([18, 52, 86]);
  });
  it('rejects out-of-bounds crops and arbitrary processing controls', () => {
    expect(() =>
      imageTransforms.parse({ crop: { x: 0.9, y: 0, width: 0.5, height: 1 } }),
    ).toThrow();
    expect(() => imageTransforms.parse({ rotation: 45 })).toThrow();
    expect(() => imageTransforms.parse({ quality: 100 })).toThrow();
    expect(() => imageTransforms.parse({ svg: '<script/>' })).toThrow();
  });
});
