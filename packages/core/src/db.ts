import { Pool, type PoolClient, type QueryResultRow } from 'pg';
import { config } from './config.js';
import { beginDeliveryWrite, endDeliveryWrite } from './delivery-cache.js';
let pool: Pool | undefined;
export function database(): Pool {
  return (pool ??= new Pool({
    connectionString: config().DATABASE_URL,
    max: 20,
    connectionTimeoutMillis: 5000,
    statement_timeout: 10000,
    query_timeout: 12_000,
    idleTimeoutMillis: 30000,
  }));
}
export type DB = Pool | PoolClient;
type Fence = { started: boolean; promise: Promise<void> };
const transactions = new WeakMap<PoolClient, { fence?: Fence }>();
/** Keep this list aligned with delivery projection joins. Operator SQL writes require maintenance fencing. */
export function affectsDelivery(sql: string): boolean {
  return /\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+(?:public\.)?(?:identities|handles|personas|media|avatar_selections|memberships|accounts|applications|domains)\b/i.test(
    sql,
  );
}
export async function query<T extends QueryResultRow = QueryResultRow>(
  sql: string,
  values: unknown[] = [],
  db: DB = database(),
): Promise<T[]> {
  if (!affectsDelivery(sql)) return (await db.query<T>(sql, values)).rows;
  const tx = transactions.get(db as PoolClient);
  if (tx) {
    if (!tx.fence) {
      const fence: Fence = { started: false, promise: Promise.resolve() };
      tx.fence = fence;
      fence.promise = beginDeliveryWrite().then(() => {
        fence.started = true;
      });
    }
    await tx.fence.promise;
    return (await db.query<T>(sql, values)).rows;
  }
  await beginDeliveryWrite();
  try {
    return (await db.query<T>(sql, values)).rows;
  } finally {
    await endDeliveryWrite();
  }
}
export async function transaction<T>(fn: (db: PoolClient) => Promise<T>): Promise<T> {
  const db = await database().connect(),
    tx: { fence?: Fence } = {};
  transactions.set(db, tx);
  try {
    await db.query('BEGIN');
    const result = await fn(db);
    await db.query('COMMIT');
    return result;
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  } finally {
    transactions.delete(db);
    try {
      if (tx.fence?.started) await endDeliveryWrite();
    } finally {
      db.release();
    }
  }
}
export async function closeDatabase(): Promise<void> {
  await pool?.end();
}
