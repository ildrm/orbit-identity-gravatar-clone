import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const source = readFileSync('docs/product/original-prompt.md', 'utf8');
const roleSection = source.slice(
  source.indexOf('# 1. OPERATING MODE'),
  source.indexOf('# 2. CORE PRODUCT VISION'),
);
const roles = [...roleSection.matchAll(/^- ([^\r\n]+)$/gm)].map((match) => match[1]);
const catalog = readFileSync('docs/product/roles.md', 'utf8');
assert.equal(roles.length, 81);
assert.equal(new Set(roles).size, 81);
for (const role of roles) {
  const rows = catalog
    .split('\n')
    .filter((row) => row.startsWith('|') && row.split('|')[1].trim() === role);
  assert.equal(rows.length, 1, 'Extracted role appears exactly once: ' + role);
  assert.ok(
    rows[0].split('|')[2].trim().length > 30,
    'Role has a concrete responsibility: ' + role,
  );
}
const sections = [...source.matchAll(/^# (\d+)\. ([^\r\n]+)/gm)].map((match) => Number(match[1]));
assert.deepEqual(
  sections,
  Array.from({ length: 132 }, (_, i) => i + 1),
);
const ledger = readFileSync('docs/product/feature-matrix.csv', 'utf8');
assert.equal(ledger.trim().split('\n').length, 133);
for (const id of sections)
  assert.ok(
    ledger.split('\n').some((line) => line.startsWith('"' + id + '",')),
    'Requirement retained: ' + id,
  );
console.log('All 81 role responsibilities and 132 original requirement sections are retained.');
