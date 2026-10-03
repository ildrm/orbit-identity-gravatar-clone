import { readFileSync, writeFileSync } from 'node:fs';
const path = 'apps/delivery/src/main.ts';
let s = readFileSync(path, 'utf8');
s = s
  .replace('import { query, closeDatabase }', 'import { closeDatabase }')
  .replace(
    "import { selectedAvatar } from '../../../packages/core/src/avatar-selection.js';",
    "import {avatarProjection,assetProjection} from '../../../packages/core/src/delivery-projection.js';",
  );
let start = s.indexOf('    const [i] = await query<'),
  end = s.indexOf('      const format = String(req.query.format', start);
if (start < 0 || end < 0) throw Error('Avatar refactor anchor missing');
s =
  s.slice(0, start) +
  `    const {identity:i,mediaId,variants}=await avatarProjection(identifier,typeof req.query.persona==='string'?req.query.persona:null,typeof req.query.application==='string'?req.query.application:null,typeof req.query.domain==='string'?req.query.domain:null);
    if(i?.analytics_enabled)await recordAggregate(i.id,'avatar_request',req.headers.dnt==='1'||req.headers['sec-gpc']==='1');
    if(i&&mediaId){
` +
  s.slice(end);
s = s.replace(
  "key = m?.variants[format === 'webp' ? String(width) : width + '.' + format]",
  "key = variants[format === 'webp' ? String(width) : width + '.' + format]",
);
start = s.indexOf('    const [m] = await query<');
end = s.indexOf('    const format = variant.split', start);
if (start < 0 || end < 0) throw Error('Asset refactor anchor missing');
s = s.slice(0, start) + '    const variants=await assetProjection(media);\n' + s.slice(end);
s = s.replace(
  "key = m?.variants[format === 'webp' ? width : variant]",
  "key = variants[format === 'webp' ? width : variant]",
);
writeFileSync(path, s);
