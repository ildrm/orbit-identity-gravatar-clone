import { createServer, connect } from 'node:net';
const routes = [
  [5432, '11.255.254.10', 5432],
  [6379, '11.255.254.11', 6379],
  [8025, '11.255.254.20', 8025],
  [9000, '11.255.254.30', 9000],
  [4000, '11.255.254.50', 4000],
  [4001, '11.255.254.53', 4001],
];
for (const [port, host, target] of routes)
  createServer((client) => {
    const upstream = connect({ host, port: target });
    client.on('error', () => upstream.destroy());
    upstream.on('error', () => client.destroy());
    client.on('close', () => upstream.destroy());
    upstream.on('close', () => client.destroy());
    client.pipe(upstream);
    upstream.pipe(client);
  }).listen(port, '0.0.0.0');
