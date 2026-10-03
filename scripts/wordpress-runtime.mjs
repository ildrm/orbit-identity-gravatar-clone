import { execFileSync, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { writeFileSync, existsSync, mkdirSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
const suffix = randomBytes(6).toString('hex'),
  name = 'orbit-wordpress-' + suffix,
  password = randomBytes(32).toString('base64url'),
  core = resolve('reports/wordpress/runtime/wordpress'),
  config = core + '/wp-config.php';
assert.ok(existsSync(core + '/wp-load.php'), 'Extract the official WordPress core archive first.');
function docker(args) {
  return execFileSync('docker', args, {
    encoding: 'utf8',
    timeout: 60_000,
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}
let created = false;
try {
  docker([
    'run',
    '--rm',
    '-d',
    '--name',
    name,
    '--tmpfs',
    '/var/lib/mysql:rw,size=384m',
    '-p',
    '127.0.0.1::3306',
    '-e',
    'MARIADB_RANDOM_ROOT_PASSWORD=yes',
    '-e',
    'MARIADB_DATABASE=wordpress',
    '-e',
    'MARIADB_USER=wordpress',
    '-e',
    'MARIADB_PASSWORD=' + password,
    'mariadb:10.11',
  ]);
  created = true;
  const port = docker(['port', name, '3306/tcp']).match(/127\.0\.0\.1:(\d+)/)?.[1];
  assert.ok(port);
  for (let n = 0; n < 120; n++) {
    const ready = spawnSync(
      'docker',
      ['exec', name, 'healthcheck.sh', '--connect', '--innodb_initialized'],
      { stdio: 'ignore' },
    );
    if (ready.status === 0) break;
    if (n === 119) throw Error('WordPress test database failed readiness');
    await new Promise((r) => setTimeout(r, 500));
  }
  mkdirSync(core + '/wp-content/mu-plugins', { recursive: true });
  writeFileSync(
    core + '/wp-content/mu-plugins/orbit-runtime.php',
    "<?php require '" +
      resolve('integrations/wordpress/orbit-identity.php').replaceAll('\\', '/') +
      "';" +
      String.fromCharCode(10),
  );
  writeFileSync(
    config,
    "<?php\ndefine('DB_NAME','wordpress');define('DB_USER','wordpress');define('DB_PASSWORD','" +
      password +
      "');define('DB_HOST','127.0.0.1:" +
      port +
      "');define('DB_CHARSET','utf8mb4');define('DB_COLLATE','');define('WP_DEBUG',false);define('WP_HOME','http://wordpress.example.test');define('WP_SITEURL','http://wordpress.example.test');define('WP_HTTP_BLOCK_EXTERNAL',false);$table_prefix='wp_';if(!defined('ABSPATH'))define('ABSPATH',__DIR__.'/');require_once ABSPATH.'wp-settings.php';\n",
    { mode: 0o600 },
  );
  const test = spawnSync('php', ['tests/wordpress/runtime.php'], {
    stdio: 'inherit',
    timeout: 120_000,
    env: {
      ...process.env,
      ORBIT_WP_CORE: core,
      ORBIT_WP_REPORT: resolve('reports/wordpress-runtime.json'),
    },
  });
  assert.equal(test.status, 0, 'WordPress runtime integration failed');
} finally {
  if (created) docker(['rm', '-f', name]);
  if (existsSync(config)) unlinkSync(config);
}
