import type { Express } from 'express';
import { Registry, Gauge, collectDefaultMetrics } from 'prom-client';
import { database, query } from './db.js';
export function operationalMetrics(
  app: Express,
  service: string,
  heartbeat: () => number,
  queue = false,
) {
  const registry = new Registry();
  registry.setDefaultLabels({ service });
  collectDefaultMetrics({ register: registry });
  new Gauge({
    name: 'identity_heartbeat_age_seconds',
    help: 'Seconds since the last successful service iteration',
    registers: [registry],
    collect() {
      this.set(Math.max(0, (Date.now() - heartbeat()) / 1000));
    },
  });
  new Gauge({
    name: 'identity_database_pool_waiting',
    help: 'Requests waiting for a database connection',
    registers: [registry],
    collect() {
      this.set(database().waitingCount);
    },
  });
  if (queue) {
    new Gauge({
      name: 'identity_jobs',
      help: 'Durable jobs by lifecycle state',
      labelNames: ['state'],
      registers: [registry],
      async collect() {
        this.reset();
        for (const row of await query<{ status: string; count: string }>(
          'SELECT status,count(*) AS count FROM jobs GROUP BY status',
        ))
          this.set({ state: row.status }, Number(row.count));
      },
    });
    new Gauge({
      name: 'identity_queue_lag_seconds',
      help: 'Age of the oldest due durable job',
      registers: [registry],
      async collect() {
        const [row] = await query<{ lag: string }>(
          "SELECT COALESCE(EXTRACT(EPOCH FROM now()-min(created_at)),0) AS lag FROM jobs WHERE status='PENDING' AND run_after<=now()",
        );
        this.set(Math.max(0, Number(row?.lag ?? 0)));
      },
    });
  }
  app.get('/metrics', async (_req, res) => {
    try {
      res.type(registry.contentType).send(await registry.metrics());
    } catch {
      res.sendStatus(503);
    }
  });
  return registry;
}
