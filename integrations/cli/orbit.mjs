#!/usr/bin/env node
const [command, identifier] = process.argv.slice(2),
  origin = process.env.ORBIT_ORIGIN,
  token = process.env.ORBIT_TOKEN;
if (!origin) {
  process.stderr.write('Set ORBIT_ORIGIN to your HTTPS instance URL.\n');
  process.exit(1);
}
const u = new URL(origin);
if (u.username || u.password || (u.protocol !== 'https:' && !(u.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(u.hostname))))
  throw new Error('HTTPS required');
const paths = {
  resolve:'/api/v1/resolve?type='+encodeURIComponent(identifier??'native')+'&identifier='+encodeURIComponent(process.argv[4]??''),
  credentials:'/api/v1/oauth/credentials',
  'oauth-profile':'/api/v1/oauth/profile',
  profile: '/api/v1/profiles/' + encodeURIComponent(identifier ?? ''),
  whoami: '/api/v1/application/profile',
  search: '/api/v1/search?q=' + encodeURIComponent(identifier ?? ''),
};
if (!Object.hasOwn(paths, command)) {
  process.stderr.write('Usage: orbit profile <handle> | whoami | oauth-profile | credentials | search <query> | resolve <native|email|domain|github|did> <value>\n');
  process.exit(1);
}
const r = await fetch(u.origin + paths[command], {
  headers: token ? { Authorization: 'Bearer ' + token } : {},
  signal: AbortSignal.timeout(5000),
  redirect: 'error',
});
const body = await r.json();
if (!r.ok) {
  process.stderr.write(
    (body.code ?? body.error ?? 'REQUEST_FAILED') + ': ' + (body.message ?? body.error_description ?? 'Request failed') + '\n',
  );
  process.exit(1);
}
process.stdout.write(JSON.stringify(body, null, 2) + '\n');
