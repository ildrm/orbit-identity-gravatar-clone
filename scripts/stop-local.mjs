import { execFileSync } from 'node:child_process';
const mapping = {
  4000: 'dist/apps/api/src/main.js',
  4001: 'dist/apps/delivery/src/main.js',
  4010: 'dist/apps/worker/src/main.js',
  8080: 'apps/web/.next/standalone/apps/web/server.js',
};
for (const portText of process.argv.slice(2)) {
  const port = Number(portText);
  if (!Object.hasOwn(mapping, port)) throw new Error('Unrecognized task port');
  const raw = execFileSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-Command',
      'Get-NetTCPConnection -LocalPort ' +
        port +
        ' -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess | ConvertTo-Json',
    ],
    { encoding: 'utf8' },
  ).trim();
  if (!raw) continue;
  const result = JSON.parse(raw),
    pids = Array.isArray(result) ? result : [result];
  for (const pid of pids) {
    if (!Number.isInteger(pid) || pid < 1) throw new Error('Invalid task PID');
    const command = execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-Command',
        '(Get-CimInstance Win32_Process -Filter "ProcessId = ' + pid + '").CommandLine',
      ],
      { encoding: 'utf8' },
    )
      .trim()
      .replaceAll('\\', '/');
    if (!command.includes(mapping[port]))
      throw new Error('Process does not match this project service on port ' + port);
    execFileSync('powershell.exe', ['-NoProfile', '-Command', 'Stop-Process -Id ' + pid], {
      stdio: 'ignore',
    });
    process.stdout.write('Stopped task service on port ' + port + '\n');
  }
}
