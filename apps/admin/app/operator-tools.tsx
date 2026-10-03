'use client';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
type Row = Record<string, unknown>;
async function request<T>(path: string, method = 'GET', body?: Row): Promise<T> {
  const r = await fetch('/api/v1' + path, {
    method,
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.message || 'Operation unavailable');
  return d;
}
function Security() {
  return (
    <>
      <label>
        Current password
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          maxLength={128}
          required
        />
      </label>
      <label>
        Authenticator or backup code, if enabled
        <input name="code" maxLength={20} autoComplete="one-time-code" />
      </label>
    </>
  );
}
async function proof(f: FormData) {
  return (
    await request<{ proof: string }>('/auth/stepup', 'POST', {
      password: f.get('password'),
      ...(f.get('code') ? { code: f.get('code') } : {}),
    })
  ).proof;
}
export function OperatorTools() {
  const [tab, setTab] = useState('appeals'),
    [rows, setRows] = useState<Row[]>([]),
    [error, setError] = useState(''),
    [status, setStatus] = useState(''),
    [evidence, setEvidence] = useState<{ evidence: string; reviews: Row[] } | null>(null),
    [discovery, setDiscovery] = useState<Row | null>(null);
  const paths: Record<string, string> = {
    appeals: '/admin/appeals',
    legacy: '/admin/legacy',
    peers: '/admin/federation/peers',
    schemas: '/schemas',
    links: '/admin/link-hosts',
  };
  const path = paths[tab];
  const reload = useCallback(async () => {
    try {
      setRows(await request<Row[]>(path));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Queue unavailable');
    }
  }, [path]);
  useEffect(() => {
    void reload();
  }, [reload]);
  async function act(e: FormEvent<HTMLFormElement>, action: string, row?: Row) {
    e.preventDefault();
    setError('');
    setStatus('');
    try {
      const f = new FormData(e.currentTarget);
      let target = '',
        method = 'POST',
        body: Row = {};
      if (action === 'appeal') {
        target = '/admin/appeals/' + row!.id;
        body = { decision: f.get('decision'), reason: f.get('reason') };
      }
      if (action === 'legacy-review') {
        target = '/admin/legacy/' + row!.id + '/review';
        body = { decision: f.get('decision'), reason: f.get('reason'), proof: await proof(f) };
      }
      if (action === 'legacy-apply') {
        target = '/admin/legacy/' + row!.id + '/apply';
        body = { proof: await proof(f) };
      }
      if (action === 'peer') {
        target = '/admin/federation/peers';
        body = { origin: f.get('origin'), fingerprint: f.get('fingerprint') };
      }
      if (action === 'rotate') {
        target = '/admin/federation/keys/rotate';
        body = { proof: await proof(f) };
      }
      if (action === 'revoke-key') {
        target = '/admin/federation/keys/' + encodeURIComponent(String(f.get('keyId')));
        method = 'DELETE';
        body = { proof: await proof(f) };
      }
      if (action === 'schema') {
        target = '/admin/schemas';
        body = {
          key: f.get('key'),
          version: Number(f.get('version')),
          type: f.get('type'),
          title: f.get('title'),
          description: f.get('description'),
          maxLength: Number(f.get('maxLength')),
          localized: f.get('localized') === 'on',
          indexable: f.get('indexable') === 'on',
        };
      }
      if (action === 'link') {
        target = '/admin/link-hosts';
        body = { host: f.get('host'), reason: f.get('reason') };
      }
      const result = await request<Row>(target, method, body);
      if (action === 'rotate' || action === 'revoke-key') setDiscovery(result);
      setStatus(String(result.message || 'Change recorded.'));
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Operation unavailable');
    }
  }
  async function remove(path: string) {
    setError('');
    try {
      const result = await request<Row>(path, 'DELETE');
      setStatus(String(result.message || 'Removed.'));
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Operation unavailable');
    }
  }
  return (
    <section className="stack">
      <h2>Trust and node operations</h2>
      <nav className="actions" aria-label="Operator queues">
        {[
          ['appeals', 'Appeals'],
          ['legacy', 'Digital legacy'],
          ['peers', 'Federation'],
          ['schemas', 'Schemas'],
          ['links', 'Link safety'],
        ].map(([id, title]) => (
          <button
            key={id}
            className={'button ' + (id === tab ? 'primary' : 'secondary')}
            aria-pressed={id === tab}
            onClick={() => {
              setTab(id);
              setEvidence(null);
              setError('');
              setStatus('');
            }}
          >
            {title}
          </button>
        ))}
      </nav>
      {error && (
        <p role="alert" className="notice error">
          {error}
        </p>
      )}
      {status && (
        <p role="status" className="notice success">
          {status}
        </p>
      )}
      <button className="button secondary" onClick={() => void reload()}>
        Refresh queue
      </button>
      {tab === 'appeals' && (
        <>
          <p>
            An appeal requires a reviewer other than the original moderator or the affected owner.
            Overturned restrictions restore the identity privately.
          </p>
          {rows.map((row) => (
            <article className="card stack" key={String(row.id)}>
              <h3>
                {String(row.category)} · {String(row.identity_id)}
              </h3>
              <p>Original decision: {String(row.original_disposition)}</p>
              <p>Owner appeal: {String(row.reason)}</p>
              <form className="form-stack" onSubmit={(e) => act(e, 'appeal', row)}>
                <label>
                  Decision
                  <select name="decision">
                    <option value="UPHELD">Uphold</option>
                    <option value="OVERTURNED">Overturn restriction</option>
                  </select>
                </label>
                <label>
                  Independent review reason
                  <textarea name="reason" minLength={50} maxLength={3000} required />
                </label>
                <button className="button primary">Record independent decision</button>
              </form>
            </article>
          ))}
        </>
      )}
      {tab === 'legacy' && (
        <>
          <p>
            Two independent reviewers and the full 30-day waiting period are required. Owners and
            beneficiaries cannot approve their own requests.
          </p>
          {rows.map((row) => (
            <article className="card stack" key={String(row.id)}>
              <h3>
                {String(row.identity_id)} · {String(row.outcome)}
              </h3>
              <p>
                {String(row.state)} · Earliest action:{' '}
                {new Date(String(row.not_before)).toLocaleString()}
              </p>
              <button
                className="button secondary"
                onClick={async () => {
                  try {
                    setEvidence(await request('/admin/legacy/' + row.id));
                  } catch (e) {
                    setError(e instanceof Error ? e.message : 'Evidence unavailable');
                  }
                }}
              >
                Inspect evidence and reviews
              </button>
              <form className="form-stack" onSubmit={(e) => act(e, 'legacy-review', row)}>
                <label>
                  Review
                  <select name="decision">
                    <option value="APPROVE">Approve evidence</option>
                    <option value="REJECT">Reject</option>
                  </select>
                </label>
                <label>
                  Reason
                  <textarea name="reason" minLength={50} maxLength={3000} required />
                </label>
                <Security />
                <button className="button secondary">Record review</button>
              </form>
              {row.state === 'APPROVED' && (
                <form className="form-stack" onSubmit={(e) => act(e, 'legacy-apply', row)}>
                  <Security />
                  <label className="check">
                    <input type="checkbox" required />
                    Apply the configured outcome after all safeguards pass
                  </label>
                  <button className="button danger">Apply legacy policy</button>
                </form>
              )}
            </article>
          ))}
          {evidence && (
            <article className="card stack">
              <h3>Restricted evidence</h3>
              <p style={{ whiteSpace: 'pre-wrap' }}>
                {evidence.evidence || 'Evidence has been erased.'}
              </p>
              {evidence.reviews.map((r, i) => (
                <p key={i}>
                  {String(r.decision)} · {String(r.reason)}
                </p>
              ))}
              <button className="button secondary" onClick={() => setEvidence(null)}>
                Close evidence
              </button>
            </article>
          )}
        </>
      )}
      {tab === 'peers' && (
        <>
          <form className="card form-stack" onSubmit={(e) => act(e, 'peer')}>
            <h3>Approve a peer</h3>
            <p>
              Obtain the discovery fingerprint through a trusted operator channel. Changed keys
              require blocking and explicit reapproval.
            </p>
            <label>
              HTTPS node origin
              <input name="origin" type="url" required maxLength={2048} />
            </label>
            <label>
              SHA-256 discovery fingerprint
              <input name="fingerprint" pattern="[a-f0-9]{64}" maxLength={64} required />
            </label>
            <button className="button primary">Verify and pin peer</button>
          </form>
          {rows.map((row) => (
            <article className="card stack" key={String(row.id)}>
              <h3>{String(row.origin)}</h3>
              <p>{row.blocked_at ? 'Blocked' : 'Approved'}</p>
              <code>{String(row.fingerprint)}</code>
              {!row.blocked_at && (
                <button
                  className="button danger"
                  onClick={() => remove('/admin/federation/peers/' + row.id)}
                >
                  Block peer and purge cache
                </button>
              )}
            </article>
          ))}
          <form className="card form-stack" onSubmit={(e) => act(e, 'rotate')}>
            <h3>Rotate node signing key</h3>
            <Security />
            <button className="button secondary">Rotate and show new fingerprint</button>
          </form>
          <form className="card form-stack" onSubmit={(e) => act(e, 'revoke-key')}>
            <h3>Revoke a node signing key</h3>
            <label>
              Key ID
              <input name="keyId" required maxLength={100} />
            </label>
            <Security />
            <button className="button danger">Revoke key</button>
          </form>
          {discovery && (
            <pre>
              <code>{JSON.stringify(discovery, null, 2)}</code>
            </pre>
          )}
        </>
      )}
      {tab === 'schemas' && (
        <>
          <form className="card form-stack" onSubmit={(e) => act(e, 'schema')}>
            <h3>Register a declarative claim schema</h3>
            <label>
              Namespaced key
              <input
                name="key"
                placeholder="x-example:member_code"
                pattern="x-[a-z0-9-]{3,40}:[a-z0-9_]{1,40}"
                required
              />
            </label>
            <label>
              Version
              <input name="version" type="number" min={1} max={1000} defaultValue={1} required />
            </label>
            <label>
              Value type
              <select name="type">
                {['text', 'number', 'boolean', 'https_url', 'text_array'].map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </label>
            <label>
              Title
              <input name="title" required maxLength={120} />
            </label>
            <label>
              Description
              <textarea name="description" required minLength={20} maxLength={2000} />
            </label>
            <label>
              Text value limit
              <input
                name="maxLength"
                type="number"
                min={1}
                max={2000}
                defaultValue={200}
                required
              />
            </label>
            <label className="check">
              <input name="localized" type="checkbox" />
              Allow localized values
            </label>
            <label className="check">
              <input name="indexable" type="checkbox" />
              Allow explicit indexing and search permission
            </label>
            <button className="button primary">Register schema</button>
          </form>
          {rows.map((row) => (
            <article className="card stack" key={String(row.key)}>
              <h3>{String(row.title)}</h3>
              <p>
                {String(row.key)} · Version {String(row.version)} · {String(row.type)}
              </p>
              <p>{String(row.description)}</p>
              <button
                className="button danger"
                onClick={() => remove('/admin/schemas/' + encodeURIComponent(String(row.key)))}
              >
                Revoke schema and claims
              </button>
            </article>
          ))}
        </>
      )}
      {tab === 'links' && (
        <>
          <form className="card form-stack" onSubmit={(e) => act(e, 'link')}>
            <h3>Block a malicious link host</h3>
            <label>
              Domain
              <input name="host" placeholder="malicious.example" required maxLength={253} />
            </label>
            <label>
              Evidence and reason
              <textarea name="reason" minLength={20} maxLength={2000} required />
            </label>
            <button className="button danger">Block public links</button>
          </form>
          {rows.map((row) => (
            <article className="card stack" key={String(row.host)}>
              <h3>{String(row.host)}</h3>
              <p>{String(row.reason)}</p>
              <button
                className="button secondary"
                onClick={() => remove('/admin/link-hosts/' + encodeURIComponent(String(row.host)))}
              >
                Remove block
              </button>
            </article>
          ))}
        </>
      )}
      {rows.length === 0 && <p>No items in this queue.</p>}
    </section>
  );
}
