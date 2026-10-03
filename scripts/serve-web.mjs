import { cpSync } from 'node:fs';
import { resolve, sep } from 'node:path';
const target = resolve('apps/web/.next/standalone/apps/web/.next/static');
if (!target.startsWith(process.cwd() + sep)) throw new Error('Invalid preview target');
cpSync('apps/web/.next/static', target, { recursive: true });
import { spawn } from 'node:child_process';
const child = spawn(process.execPath, ['apps/web/.next/standalone/apps/web/server.js'], {
  stdio: 'inherit',
  env: { ...process.env, NODE_ENV: 'production', PORT: '8080', HOSTNAME: '0.0.0.0' },
});
child.on('exit', (code) => process.exit(code ?? 1));
process.on('SIGINT', () => child.kill('SIGTERM'));
process.on('SIGTERM', () => child.kill('SIGTERM'));
