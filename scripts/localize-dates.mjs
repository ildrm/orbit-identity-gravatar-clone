import ts from 'typescript';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
for (const file of readdirSync('apps/web/components').filter((f) => f.endsWith('.tsx'))) {
  const path = 'apps/web/components/' + file,
    source = readFileSync(path, 'utf8'),
    ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX),
    edits = [],
    functions = new Set();
  function visit(n, owner) {
    if (ts.isFunctionDeclaration(n) && n.body) owner = n;
    if (
      ts.isCallExpression(n) &&
      ts.isPropertyAccessExpression(n.expression) &&
      ['toLocaleDateString', 'toLocaleString'].includes(n.expression.name.text) &&
      ts.isNewExpression(n.expression.expression) &&
      n.expression.expression.expression.getText(ast) === 'Date'
    ) {
      if (!owner || !/^[A-Z]/.test(owner.name?.text ?? ''))
        throw Error('Formatting outside a component in ' + path);
      functions.add(owner);
      edits.push([
        n.getStart(ast),
        n.end,
        'formatDate(' +
          n.expression.expression.arguments[0].getText(ast) +
          (n.expression.name.text === 'toLocaleDateString' ? ',true' : '') +
          ')',
      ]);
    }
    ts.forEachChild(n, (child) => visit(child, owner));
  }
  visit(ast, null);
  if (!edits.length) continue;
  for (const f of functions)
    edits.push([
      f.body.getStart(ast) + 1,
      f.body.getStart(ast) + 1,
      '\nconst {formatDate}=useLocale();\n',
    ]);
  edits.push([
    source.indexOf('\n') + 1,
    source.indexOf('\n') + 1,
    "import {useLocale} from '../lib/locale-context';\n",
  ]);
  let s = source;
  for (const [a, b, t] of edits.sort((a, b) => b[0] - a[0])) s = s.slice(0, a) + t + s.slice(b);
  writeFileSync(path, s);
}
console.log('Date formatting uses account locale and IANA timezone.');
