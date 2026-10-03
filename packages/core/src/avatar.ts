import { createHash } from 'node:crypto';
export type AvatarStyle = 'geometric' | 'initials' | 'rings';
export function generatedAvatar(
  seed: string,
  size = 128,
  style: AvatarStyle = 'geometric',
  color = '#5755d9',
): string {
  if (!Number.isInteger(size) || size < 16 || size > 1024) throw new Error('Invalid avatar size');
  if (!/^#[0-9a-f]{6}$/i.test(color)) throw new Error('Invalid avatar color');
  const bytes = createHash('sha256').update(seed).digest();
  const bg = '#f0f0fb';
  let shapes = '';
  if (style === 'initials') {
    const text =
      seed
        .replace(/[^a-z0-9]/gi, '')
        .slice(0, 2)
        .toUpperCase() || 'ID';
    shapes =
      '<text x="50" y="55" text-anchor="middle" dominant-baseline="middle" font-family="system-ui,sans-serif" font-size="36" font-weight="700" fill="' +
      color +
      '">' +
      text +
      '</text>';
  } else if (style === 'rings') {
    for (let i = 0; i < 4; i++)
      shapes +=
        '<circle cx="50" cy="50" r="' +
        (12 + i * 9) +
        '" fill="none" stroke="' +
        color +
        '" stroke-width="' +
        (2 + (bytes[i]! % 5)) +
        '" opacity="' +
        (0.3 + i * 0.2) +
        '"/>';
  } else {
    for (let y = 0; y < 5; y++)
      for (let x = 0; x < 3; x++)
        if (bytes[y * 3 + x]! % 2) {
          for (const mirrored of x === 2 ? [x] : [x, 4 - x])
            shapes +=
              '<rect x="' +
              (10 + mirrored * 16) +
              '" y="' +
              (10 + y * 16) +
              '" width="14" height="14" rx="' +
              (bytes[15]! % 5) +
              '" fill="' +
              color +
              '"/>';
        }
  }
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" width="' +
    size +
    '" height="' +
    size +
    '" viewBox="0 0 100 100" role="img"><rect width="100" height="100" rx="20" fill="' +
    bg +
    '"/>' +
    shapes +
    '</svg>'
  );
}
