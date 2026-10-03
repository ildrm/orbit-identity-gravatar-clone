import ts from 'typescript';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
function files(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)],
  );
}
let count = 0;
for (const path of files('apps/api/src').filter((p) => p.endsWith('.controller.ts'))) {
  const source = readFileSync(path, 'utf8'),
    ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true),
    edits = [],
    declarations = [];
  for (const cls of ast.statements.filter(ts.isClassDeclaration)) {
    for (const method of cls.members.filter(ts.isMethodDeclaration)) {
      const decorators = ts.getDecorators(method) ?? [];
      if (
        decorators.some(
          (d) =>
            ts.isCallExpression(d.expression) && d.expression.expression.getText(ast) === 'Input',
        )
      )
        continue;
      if (
        !decorators.some(
          (d) =>
            ts.isCallExpression(d.expression) &&
            ['Post', 'Put', 'Patch', 'Delete'].includes(d.expression.expression.getText(ast)),
        )
      )
        continue;
      const body = method.parameters.find((p) =>
        (ts.getDecorators(p) ?? []).some(
          (d) =>
            ts.isCallExpression(d.expression) && d.expression.expression.getText(ast) === 'Body',
        ),
      );
      if (!body || !method.body) continue;
      let call;
      function visit(n) {
        if (
          ts.isCallExpression(n) &&
          ts.isPropertyAccessExpression(n.expression) &&
          n.expression.name.text === 'parse' &&
          n.arguments[0]?.getText(ast) === body.name.getText(ast)
        ) {
          if (call) throw Error('Multiple body validators in ' + path);
          call = n;
        }
        ts.forEachChild(n, visit);
      }
      visit(method.body);
      if (!call) continue;
      const name = cls.name.text + method.name.getText(ast) + 'Input';
      declarations.push('const ' + name + ' = ' + call.expression.expression.getText(ast) + ';');
      edits.push(
        [call.expression.expression.getStart(ast), call.expression.expression.end, name],
        [method.getStart(ast), method.getStart(ast), '@Input(' + name + ')\n'],
      );
      count++;
    }
  }
  if (!edits.length) continue;
  edits.push([0, 0, "import { Input } from '../input.js';\n"]);
  const firstClass = ast.statements.find(ts.isClassDeclaration);
  edits.push([firstClass.getStart(ast), firstClass.getStart(ast), declarations.join('\n') + '\n']);
  let result = source;
  for (const [a, b, t] of edits.sort((a, b) => b[0] - a[0]))
    result = result.slice(0, a) + t + result.slice(b);
  writeFileSync(path, result);
}
console.log('Published ' + count + ' shared request validators in OpenAPI.');
