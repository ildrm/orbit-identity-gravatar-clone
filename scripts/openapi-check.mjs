import ts from 'typescript';
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import assert from 'node:assert/strict';
const origin = process.env.PUBLIC_ORIGIN ?? 'http://localhost:8080',
  spec = await fetch(origin + '/api/v1/openapi.json').then((r) => r.json());
assert.equal(spec.openapi, '3.0.0');
const routes = [];
function files(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? files(join(dir, e.name))
      : e.name.endsWith('.controller.ts')
        ? [join(dir, e.name)]
        : [],
  );
}
function decorators(node) {
  return ts.canHaveDecorators(node) ? (ts.getDecorators(node) ?? []) : [];
}
function name(d) {
  return ts.isCallExpression(d.expression) && ts.isIdentifier(d.expression.expression)
    ? d.expression.expression.text
    : '';
}
function argument(d) {
  return ts.isCallExpression(d.expression) &&
    d.expression.arguments[0] &&
    ts.isStringLiteral(d.expression.arguments[0])
    ? d.expression.arguments[0].text
    : '';
}
for (const file of files('apps/api/src')) {
  const source = ts.createSourceFile(
    file,
    readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );
  for (const node of source.statements.filter(ts.isClassDeclaration)) {
    const controller = decorators(node).find((d) => name(d) === 'Controller');
    if (!controller) continue;
    for (const method of node.members.filter(ts.isMethodDeclaration)) {
      if (!method.parameters.some((p) => decorators(p).some((d) => name(d) === 'Body'))) continue;
      const route = decorators(method).find((d) =>
        ['Post', 'Put', 'Patch', 'Delete'].includes(name(d)),
      );
      if (!route) continue;
      const path = (
        '/' + [argument(controller), argument(route)].filter(Boolean).join('/')
      ).replace(/:([a-zA-Z]+)/g, '{$1}');
      const operation = spec.paths[path]?.[name(route).toLowerCase()];
      assert.ok(operation, 'Documented body route exists: ' + path);
      const content = operation.requestBody?.content;
      assert.ok(content, 'Body contract exists: ' + path);
      let schema = Object.values(content)[0]?.schema;
      if (schema?.$ref) schema = spec.components.schemas[schema.$ref.split('/').at(-1)];
      assert.ok(
        schema && (schema.properties || schema.oneOf || schema.type === 'string'),
        'Concrete input contract: ' + path,
      );
      routes.push({ method: name(route).toUpperCase(), path });
    }
  }
}
assert.ok(routes.length >= 80, 'All body handlers must be discovered');
assert.ok(spec.components.schemas.ClaimInput.oneOf.length >= 21, 'Claim key/value alternatives');
assert.ok(
  spec.paths['/api/v1/search'].get.parameters.some(
    (p) => p.name === 'limit' && p.schema.maximum === 50,
  ),
);
assert.deepEqual(spec.paths['/api/v1/schemas'].get.security, []);
assert.deepEqual(spec.paths['/api/v1/oauth/avatar'].get.security, [{ OAuthBearer: [] }]);
assert.equal(
  spec.paths['/api/v1/oauth/token'].post.responses['400'].content['application/json'].schema.$ref,
  '#/components/schemas/OAuthError',
);
mkdirSync('reports', { recursive: true });
writeFileSync(
  'reports/openapi-contracts.json',
  JSON.stringify(
    {
      passed: true,
      checkedAt: new Date().toISOString(),
      documentedBodyRoutes: routes.length,
      routes,
    },
    null,
    2,
  ) + '\n',
);
console.log(
  'OpenAPI runtime check passed ' +
    routes.length +
    ' body contracts and typed query/auth/error contracts.',
);
