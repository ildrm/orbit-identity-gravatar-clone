import ts from 'typescript';
import { format } from 'prettier';
import { z } from 'zod';
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { policySchema } from '../dist/packages/contracts/src/index.js';
function type(s) {
  if (s.enum) return s.enum.map((v) => JSON.stringify(v)).join(' | ');
  if (s.anyOf) return s.anyOf.map(type).join(' | ');
  if (s.type === 'object')
    return (
      '{ ' +
      Object.entries(s.properties ?? {})
        .map(
          ([k, v]) =>
            JSON.stringify(k) + (s.required?.includes(k) ? '' : '?') + ': ' + type(v) + ';',
        )
        .join(' ') +
      ' }'
    );
  if (s.type === 'array') return '(' + type(s.items ?? {}) + ')[]';
  if (s.type === 'integer' || s.type === 'number') return 'number';
  if (['string', 'boolean', 'null'].includes(s.type)) return s.type;
  return 'unknown';
}
const source = ts.createSourceFile(
    'contracts.ts',
    readFileSync('packages/contracts/src/index.ts', 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  ),
  interfaces = source.statements
    .filter(
      (n) =>
        ts.isInterfaceDeclaration(n) &&
        ['PublicProfile', 'PublicClaim', 'ApiError'].includes(n.name.text),
    )
    .map((n) => n.getText(source));
if (interfaces.length !== 3) throw new Error('Public contract extraction failed');
const text =
  '// Generated from shared API contracts by scripts/build-sdks.mjs.\nexport type Policy = ' +
  type(z.toJSONSchema(policySchema)) +
  ';\n\n' +
  interfaces.join('\n\n') +
  '\n';
for (const pkg of ['sdk-typescript', 'ui'])
  writeFileSync(
    'packages/' + pkg + '/src/contracts.ts',
    await format(text, {
      parser: 'typescript',
      ...JSON.parse(readFileSync('.prettierrc.json', 'utf8')),
    }),
  );
for (const pkg of ['sdk-typescript', 'ui']) {
  const result = spawnSync(
    process.execPath,
    ['node_modules/typescript/bin/tsc', '-p', 'packages/' + pkg + '/tsconfig.build.json'],
    { stdio: 'inherit' },
  );
  if (result.status !== 0) process.exit(result.status ?? 1);
}
console.log('Generated shared public types and built installable JavaScript and React SDKs.');
