import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';

export async function performanceChecks(context) {
  const {
    db,
    request,
    ok,
    deliveryOrigin,
    person,
    path,
    app,
    accountId,
    email,
    password,
    containers,
    received,
    done,
    testHook,
  } = context;
  const policy = {
    visibility: 'PUBLIC',
    searchable: true,
    indexable: true,
    api: true,
    machine: true,
    agent: false,
    applications: [],
    transformation: 'FULL',
  };
  const privatePolicy = {
    ...policy,
    visibility: 'PRIVATE',
    searchable: false,
    indexable: false,
    api: false,
    machine: false,
  };
  const canary = 'private-performance-' + randomBytes(12).toString('hex');
  const fixtureKey = randomBytes(5).toString('hex');
  const keys = [
    'core:display_name',
    'core:preferred_name',
    'core:native_name',
    'core:transliteration',
    'core:bio',
    'core:location',
    'core:pronouns',
    'professional:job_title',
    'professional:employer',
    'org:department',
  ];
  // Seed only this runner's disposable database before requests; never mutate a running public fixture cache.
  await db.query('BEGIN');
  try {
    for (let n = 0; n < 100; n++) {
      const identity = n === 0 ? person.id : 'idn_' + randomBytes(16).toString('hex');
      const handle = n === 0 ? person.handle : 'perf' + fixtureKey + String(n);
      if (n > 0) {
        await db.query(
          "INSERT INTO identities(id,type,handle,visibility,searchable,indexable,machine) VALUES($1,'PERSON',$2,'PUBLIC',true,true,true)",
          [identity, handle],
        );
        await db.query('INSERT INTO handles(handle,identity_id) VALUES($1,$2)', [handle, identity]);
        await db.query(
          "INSERT INTO memberships(identity_id,account_id,role) VALUES($1,$2,'OWNER')",
          [identity, accountId],
        );
      }
      for (const key of keys) {
        const value = key === 'core:bio' ? canary : 'Performance fixture ' + n;
        await db.query(
          'INSERT INTO claims(id,identity_id,key,value,policy,actor_id) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING',
          [
            'clm_' + randomBytes(16).toString('hex'),
            identity,
            key,
            JSON.stringify(value),
            JSON.stringify(key === 'core:bio' ? privatePolicy : policy),
            accountId,
          ],
        );
      }
    }
    await db.query('COMMIT');
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  }
  const dataset = await db.query(
    'SELECT (SELECT count(*)::int FROM identities) identities,(SELECT count(*)::int FROM claims) claims',
  );
  assert.equal(dataset.rows[0].identities, 100);
  assert.equal(dataset.rows[0].claims, 1000);
  const grant = await ok(path + '/consents', {
    method: 'POST',
    body: {
      applicationId: app.id,
      scopes: ['identity.read', 'profile.basic', 'avatar.read'],
      fields: ['core:display_name'],
    },
  });
  await ok(path + '/settings', {
    method: 'PUT',
    body: { visibility: 'PUBLIC', searchable: true, indexable: true, machine: true, agent: false },
  });
  const readyMedia = (
    await db.query("SELECT id FROM media WHERE identity_id=$1 AND status='READY' LIMIT 1", [
      person.id,
    ])
  ).rows[0];
  assert.ok(readyMedia);
  await ok(path + '/media/' + readyMedia.id + '/activate', { method: 'PUT' });
  const groups = [];
  const budget = { read: 1000, write: 1000, authentication: 2000, queue: 1000, worker: 30000 };
  async function measure(name, count, concurrency, maximum, action) {
    let next = 0;
    const latencies = [],
      failures = [];
    const start = performance.now();
    await Promise.all(
      Array.from({ length: concurrency }, async () => {
        while (next < count) {
          const n = next++,
            tick = performance.now();
          try {
            await action(n);
          } catch (error) {
            failures.push(error.message.slice(0, 180));
          }
          latencies.push(performance.now() - tick);
        }
      }),
    );
    const elapsedMs = performance.now() - start,
      sorted = latencies.sort((a, b) => a - b);
    const percentile = (q) => Math.round(sorted[Math.max(0, Math.ceil(sorted.length * q) - 1)]);
    const result = {
      name,
      samples: count,
      concurrency,
      p50Ms: percentile(0.5),
      p95Ms: percentile(0.95),
      p99Ms: percentile(0.99),
      elapsedMs: Math.round(elapsedMs),
      operationsPerSecond: +(count / (elapsedMs / 1000)).toFixed(2),
      errorRate: failures.length / count,
      failures,
      budgetP95Ms: maximum,
    };
    groups.push(result);
    console.log('PERFORMANCE ' + name + ' p95=' + result.p95Ms + 'ms samples=' + count);
    assert.equal(failures.length, 0, name + ' has no failed operations');
    assert.ok(result.p95Ms < maximum, name + ' meets its local p95 budget');
  }
  function publicBody(r) {
    assert.equal(r.status, 200);
    assert.equal(r.data.id, person.id);
    assert.ok(
      !JSON.stringify(r.data).includes(canary),
      'Public projection must exclude the private canary',
    );
  }
  await measure('avatar generated, warm and cold identifiers', 20, 3, budget.read, async (n) => {
    const response = await fetch(
      deliveryOrigin + '/avatar/perfmissing' + (n % 5) + '?size=128&format=svg',
      { signal: AbortSignal.timeout(10000) },
    );
    assert.equal(response.status, 200);
    assert.ok((await response.text()).startsWith('<svg'));
  });
  await measure(
    'avatar processed image, projection and object cache',
    20,
    3,
    budget.read,
    async () => {
      const response = await fetch(
        deliveryOrigin + '/avatar/' + person.id + '?size=128&format=webp',
        { signal: AbortSignal.timeout(10000) },
      );
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('content-type'), 'image/webp');
      assert.ok((await response.arrayBuffer()).byteLength > 20);
    },
  );
  await measure('public profile at 100 identities and 1000 claims', 12, 3, budget.read, async () =>
    publicBody(await request('/api/v1/profiles/' + person.id)),
  );
  await measure('native identifier resolution', 12, 2, budget.read, async () => {
    const r = await request('/api/v1/resolve?type=native&identifier=' + person.id);
    assert.equal(r.status, 200);
    publicBody({ status: r.status, data: r.data.profile });
  });
  await measure('search with private claim exclusion', 10, 2, budget.read, async () => {
    const r = await request('/api/v1/search?q=Performance&limit=20');
    assert.equal(r.status, 200);
    assert.ok(r.data.items.length > 0);
    assert.ok(!JSON.stringify(r.data).includes(canary));
  });
  await measure('consented API reads and access logging', 12, 2, budget.read, async () => {
    const r = await request('/api/v1/application/profile', {
      headers: { Authorization: 'Bearer ' + grant.token },
    });
    publicBody(r);
    assert.ok(
      r.data.claims.every((c) => c.key === 'core:display_name'),
      'Consent field intersection',
    );
  });
  await measure('transactional API writes and cache invalidation', 8, 1, budget.write, async () => {
    await ok(path + '/settings', {
      method: 'PUT',
      body: {
        visibility: 'PUBLIC',
        searchable: true,
        indexable: true,
        machine: true,
        agent: false,
      },
    });
  });
  await measure('Argon2 authentication', 6, 1, budget.authentication, async () => {
    const r = await request('/api/v1/auth/login', {
      method: 'POST',
      body: { email: context.currentEmail ?? email, password },
    });
    assert.equal(r.status, 201, 'Login creates an authenticated session');
  });
  await measure('webhook acceptance and HTTPS worker completion', 3, 1, budget.worker, async () => {
    const before = received().length,
      tick = performance.now(),
      job = await testHook();
    assert.ok(performance.now() - tick < budget.queue, 'Durable webhook queue acceptance budget');
    await done(job);
    assert.ok(received().length > before);
    assert.ok(received().at(-1).signatureValid);
  });
  await measure(
    'worker portable JSON and compressed media export',
    3,
    1,
    budget.worker,
    async () => {
      const job = await ok(path + '/exports', { method: 'POST' });
      const start = Date.now();
      while (Date.now() - start < 30000) {
        const row = (
          await db.query('SELECT status,object_key,archive_key FROM exports WHERE id=$1', [job.id])
        ).rows[0];
        if (row?.status === 'READY') {
          assert.ok(row.object_key && row.archive_key);
          return;
        }
        await new Promise((r) => setTimeout(r, 100));
      }
      throw Error('Export did not finish within local worker budget');
    },
  );
  const stats = execFileSync(
    'docker',
    ['stats', '--no-stream', '--format', '{{json .}}', ...containers],
    { encoding: 'utf8', timeout: 30000 },
  )
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  const redisInfo = execFileSync('docker', ['exec', containers[3], 'redis-cli', 'INFO'], {
    encoding: 'utf8',
    timeout: 15000,
  })
    .split(/\r?\n/)
    .filter((line) =>
      /^(used_memory:|used_memory_peak:|used_cpu_sys:|used_cpu_user:|keyspace_hits:|keyspace_misses:|connected_clients:)/.test(
        line,
      ),
    );
  const pgStats = (
    await db.query(
      'SELECT numbackends,xact_commit,xact_rollback,blks_read,blks_hit,tup_returned,tup_fetched,deadlocks FROM pg_stat_database WHERE datname=current_database()',
    )
  ).rows[0];
  const queue = (
    await db.query(
      "SELECT status,count(*)::int jobs,max(EXTRACT(EPOCH FROM now()-created_at))::int oldestAgeSeconds FROM jobs WHERE status IN ('PENDING','RUNNING','DEAD') GROUP BY status",
    )
  ).rows;
  const result = {
    passed: true,
    checkedAt: new Date().toISOString(),
    kind: 'bounded local production-code fixture benchmark',
    dataset: dataset.rows[0],
    groups,
    resources: { containers: stats, postgresql: pgStats, redis: redisInfo, queue },
    limits:
      'Small bounded samples on one workstation and an isolated Docker bridge; p99 is a sample maximum, not a capacity or public CDN SLO. Normal production request quotas remain enforced. Includes warm/cold generated IDs, current uploaded avatar, and private canary checks.',
  };
  writeFileSync('reports/performance.json', JSON.stringify(result, null, 2) + '\n');
}
