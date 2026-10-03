'use client';
import { useState, useEffect, useCallback, type FormEvent } from 'react';
import { api, message } from '../lib/api';
import type { Identity } from './dashboard';
import { FederationMigration } from './federation-migration';
type Row = Record<string, unknown>;
function Notice({ error, status }: { error: string; status: string }) {
  return (
    <>
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
    </>
  );
}
function SecurityFields() {
  return (
    <>
      <label>
        Current password
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          required
          maxLength={128}
        />
      </label>
      <label>
        Authenticator or backup code, if enabled
        <input name="code" autoComplete="one-time-code" maxLength={20} />
      </label>
    </>
  );
}
export async function freshProof(f: FormData) {
  return (
    await api<{ proof: string }>('/auth/stepup', {
      method: 'POST',
      body: JSON.stringify({
        password: String(f.get('password')),
        code: String(f.get('code') || '') || undefined,
      }),
    })
  ).proof;
}
export function CredentialsPanel({ identity }: { identity: Identity }) {
  const path = '/identities/' + identity.id,
    [document, setDocument] = useState<Row | null>(null),
    [associations, setAssociations] = useState<Row[]>([]),
    [credentials, setCredentials] = useState<Row[]>([]),
    [error, setError] = useState(''),
    [status, setStatus] = useState(''),
    [challenge, setChallenge] = useState<Row | null>(null),
    [download, setDownload] = useState(''),
    [verification, setVerification] = useState<Row | null>(null);
  const reload = useCallback(async () => {
    try {
      const [a, c] = await Promise.all([
        api<Row[]>(path + '/did/associations'),
        api<Row[]>(path + '/credentials'),
      ]);
      setAssociations(a);
      setCredentials(c);
      try {
        setDocument(await api<Row>('/dids/' + identity.id + '/did.json'));
      } catch {
        setDocument(null);
      }
    } catch (e) {
      setError(message(e));
    }
  }, [path, identity.id]);
  useEffect(() => {
    void reload();
  }, [reload]);
  async function key(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError('');
    try {
      const f = new FormData(e.currentTarget),
        proof = await freshProof(f);
      setDocument(
        await api<Row>(path + '/did/' + String(f.get('action')), {
          method: 'POST',
          body: JSON.stringify({ proof }),
        }),
      );
      setStatus('DID key updated. Retired keys remain available for existing credentials.');
      await reload();
    } catch (e) {
      setError(message(e));
    }
  }
  async function revoke(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError('');
    try {
      const f = new FormData(e.currentTarget),
        proof = await freshProof(f);
      await api(path + '/did/keys/' + encodeURIComponent(String(f.get('keyId'))), {
        method: 'DELETE',
        body: JSON.stringify({ proof }),
      });
      setStatus('Key revoked. Credentials signed by it are now invalid.');
      await reload();
    } catch (e) {
      setError(message(e));
    }
  }
  async function associate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError('');
    try {
      const f = new FormData(e.currentTarget),
        did = String(f.get('did')),
        proof = String(f.get('signedProof') || '');
      if (!proof) {
        setChallenge(
          await api<Row>(path + '/did/challenge', {
            method: 'POST',
            body: JSON.stringify({ did }),
          }),
        );
        setStatus(
          'Sign the challenge using your external DID authentication key, then submit the signed proof.',
        );
      } else {
        await api(path + '/did/associate', {
          method: 'POST',
          body: JSON.stringify({ did, proof }),
        });
        setChallenge(null);
        setStatus('DID association verified.');
        await reload();
      }
    } catch (e) {
      setError(message(e));
    }
  }
  async function issue(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError('');
    try {
      const f = new FormData(e.currentTarget),
        result = await api<{ id: string }>('/organizations/' + identity.id + '/credentials', {
          method: 'POST',
          body: JSON.stringify({ assertionId: f.get('assertionId') }),
        });
      setStatus('Credential issued: ' + result.id);
    } catch (e) {
      setError(message(e));
    }
  }
  async function verify(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError('');
    try {
      setVerification(
        await api<Row>('/credentials/verify', {
          method: 'POST',
          body: JSON.stringify({ credential: new FormData(e.currentTarget).get('credential') }),
        }),
      );
    } catch (e) {
      setVerification(null);
      setError(message(e));
    }
  }
  return (
    <div className="stack">
      <div className="page-heading">
        <span className="eyebrow">VERIFIABLE PROVENANCE</span>
        <h1>DIDs & credentials</h1>
        <p>Control signing keys, associate another DID, and review privately issued credentials.</p>
      </div>
      <Notice error={error} status={status} />
      <section className="card">
        <h2>Identity DID</h2>
        {document ? (
          <pre>
            <code>{JSON.stringify(document, null, 2)}</code>
          </pre>
        ) : (
          <p>No identity DID is enabled yet.</p>
        )}
        <form className="form-stack" onSubmit={key}>
          <label>
            Key action
            <select name="action">
              <option value="enable">Enable DID</option>
              <option value="rotate">Rotate signing key</option>
            </select>
          </label>
          <SecurityFields />
          <button className="button primary">Update key</button>
        </form>
      </section>
      <section className="card">
        <h2>Revoke a signing key</h2>
        <p>Revocation permanently invalidates credentials issued by this key.</p>
        <form className="form-stack" onSubmit={revoke}>
          <label>
            Key ID
            <input name="keyId" required maxLength={100} />
          </label>
          <SecurityFields />
          <button className="button danger">Revoke key</button>
        </form>
      </section>
      <section className="card">
        <h2>Associate an external did:web</h2>
        <form className="form-stack" onSubmit={associate}>
          <label>
            DID
            <input name="did" required maxLength={1000} placeholder="did:web:example.org" />
          </label>
          <label>
            Signed JWS proof
            <textarea name="signedProof" maxLength={12000} rows={4} />
          </label>
          <button className="button secondary">Request challenge or verify proof</button>
        </form>
        {challenge && (
          <pre>
            <code>{JSON.stringify(challenge, null, 2)}</code>
          </pre>
        )}
        {associations.map((a) => (
          <article key={String(a.id)} className="list-row">
            <div>
              <strong>{String(a.did)}</strong>
              <p>
                Expires {String(a.expires_at)}
                {a.revoked_at ? ' · Revoked' : ''}
              </p>
            </div>
            {!a.revoked_at && (
              <button
                className="button secondary"
                onClick={async () => {
                  try {
                    await api(path + '/did/associations/' + a.id, { method: 'DELETE' });
                    await reload();
                  } catch (e) {
                    setError(message(e));
                  }
                }}
              >
                Disconnect
              </button>
            )}
          </article>
        ))}
      </section>
      {['ORGANIZATION', 'TEAM', 'COMMUNITY'].includes(identity.type) && (
        <section className="card">
          <h2>Issue an assertion credential</h2>
          <p>
            The recipient must accept the assertion first. The signed credential is delivered
            privately to the holder.
          </p>
          <form className="form-stack" onSubmit={issue}>
            <label>
              Accepted assertion ID
              <input name="assertionId" required maxLength={100} />
            </label>
            <button className="button primary">Issue credential</button>
          </form>
        </section>
      )}
      <section className="card">
        <h2>Your credentials</h2>
        {credentials.length === 0 && <p>No credentials have been issued to this identity.</p>}
        {credentials.map((c) => (
          <article key={String(c.id)} className="list-row">
            <div>
              <strong>{String(c.id)}</strong>
              <p>
                Issuer {String(c.issuer_id)} ·{' '}
                {c.revoked_at ? 'Revoked' : 'Expires ' + String(c.expires_at)}
              </p>
            </div>
            <button
              className="button secondary"
              onClick={async () => {
                try {
                  const response = await fetch('/api/v1/credentials/' + c.id, {
                    credentials: 'same-origin',
                    cache: 'no-store',
                  });
                  if (!response.ok) throw new Error('Credential download unavailable');
                  setDownload(await response.text());
                } catch (e) {
                  setError(message(e));
                }
              }}
            >
              View signed credential
            </button>
          </article>
        ))}
        {download && (
          <label>
            Signed credential
            <textarea value={download} readOnly rows={6} />
          </label>
        )}
      </section>
      <section className="card">
        <h2>Verify a local credential</h2>
        <form className="form-stack" onSubmit={verify}>
          <label>
            Credential JWS
            <textarea name="credential" required maxLength={30000} rows={5} />
          </label>
          <button className="button primary">Check signature and current status</button>
        </form>
        {verification && (
          <pre>
            <code>{JSON.stringify(verification, null, 2)}</code>
          </pre>
        )}
      </section>
    </div>
  );
}
export function FederationPanel({ identity }: { identity: Identity }) {
  const [error, setError] = useState(''),
    [status, setStatus] = useState(''),
    [enabled, setEnabled] = useState(false),
    [discovery, setDiscovery] = useState<Row | null>(null),
    [remote, setRemote] = useState<Row | null>(null);
  useEffect(() => {
    let live = true;
    Promise.all([
      api<Row>('/identities/' + identity.id + '/federation'),
      fetch('/.well-known/identity-federation', { cache: 'no-store' }).then((r) => r.json()),
    ])
      .then(([s, d]) => {
        if (live) {
          setEnabled(Boolean(s.enabled));
          setDiscovery(d);
        }
      })
      .catch((e) => {
        if (live) setError(message(e));
      });
    return () => {
      live = false;
    };
  }, [identity.id]);
  async function change() {
    setError('');
    try {
      const result = await api<{ enabled: boolean }>('/identities/' + identity.id + '/federation', {
        method: 'PUT',
        body: JSON.stringify({ enabled: !enabled }),
      });
      setEnabled(result.enabled);
      setStatus(
        result.enabled
          ? 'Federation enabled. Only public machine-readable claims are shared with operator-approved peers.'
          : 'Federation disabled. Approved peers receive a deletion update.',
      );
    } catch (e) {
      setError(message(e));
    }
  }
  async function resolve(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError('');
    try {
      setRemote(
        await api<Row>(
          '/federation/resolve?actor=' +
            encodeURIComponent(String(new FormData(e.currentTarget).get('actor'))),
        ),
      );
    } catch (e) {
      setRemote(null);
      setError(message(e));
    }
  }
  return (
    <div className="stack">
      <div className="page-heading">
        <span className="eyebrow">CONTROLLED NODE SHARING</span>
        <h1>Federation</h1>
        <p>
          Approve publication to connected nodes. Each node operator explicitly approves and pins
          peer keys.
        </p>
      </div>
      <Notice error={error} status={status} />
      <section className="card">
        <h2>Profile publication</h2>
        <p>
          Federation is {enabled ? 'enabled' : 'disabled'}. Publish your identity and allow machine
          access before enabling.
        </p>
        <button className="button primary" onClick={change}>
          {enabled ? 'Disable federation' : 'Enable federation'}
        </button>
      </section>
      <section className="card">
        <h2>Node discovery</h2>
        {discovery && (
          <pre>
            <code>{JSON.stringify(discovery, null, 2)}</code>
          </pre>
        )}
      </section>
      <section className="card">
        <h2>Resolve a connected remote identity</h2>
        <form className="form-stack" onSubmit={resolve}>
          <label>
            Remote actor URL
            <input name="actor" type="url" required maxLength={2048} />
          </label>
          <button className="button secondary">Resolve cached profile</button>
        </form>
        {remote && (
          <pre>
            <code>{JSON.stringify(remote, null, 2)}</code>
          </pre>
        )}
      </section>
      <FederationMigration identity={identity} />
    </div>
  );
}
export function WebProofsPanel({ identity }: { identity: Identity }) {
  const path = '/identities/' + identity.id + '/web-proofs',
    [rows, setRows] = useState<Row[]>([]),
    [error, setError] = useState(''),
    [status, setStatus] = useState('');
  const reload = useCallback(async () => {
    try {
      setRows(await api<Row[]>(path));
    } catch (e) {
      setError(message(e));
    }
  }, [path]);
  useEffect(() => {
    void reload();
  }, [reload]);
  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError('');
    try {
      const result = await api<{ message: string }>(path, {
        method: 'POST',
        body: JSON.stringify({ url: new FormData(e.currentTarget).get('url') }),
      });
      setStatus(result.message);
      await reload();
    } catch (e) {
      setError(message(e));
    }
  }
  return (
    <section className="card">
      <h2>Reciprocal web ownership</h2>
      <p>
        Publish a profile link to your HTTPS page. Add a rel=me link on that page pointing to your
        public profile. Proofs expire and are rechecked daily.
      </p>
      <Notice error={error} status={status} />
      <form className="form-stack" onSubmit={create}>
        <label>
          Your HTTPS page
          <input name="url" type="url" required maxLength={2048} />
        </label>
        <button className="button primary">Verify reciprocal links</button>
      </form>
      {rows.map((row) => (
        <article className="list-row" key={String(row.id)}>
          <div>
            <strong>{String(row.url)}</strong>
            <p>
              {String(row.status)} · Last checked {String(row.last_checked_at || 'Pending')}
            </p>
          </div>
          {!row.revoked_at && (
            <button
              className="button secondary"
              onClick={async () => {
                try {
                  await api(path + '/' + row.id, { method: 'DELETE' });
                  await reload();
                } catch (e) {
                  setError(message(e));
                }
              }}
            >
              Revoke
            </button>
          )}
        </article>
      ))}
    </section>
  );
}
export function CustomDomainsPanel({ identity }: { identity: Identity }) {
  const path = '/identities/' + identity.id + '/domains',
    [rows, setRows] = useState<Row[]>([]),
    [error, setError] = useState(''),
    [status, setStatus] = useState('');
  const reload = useCallback(async () => {
    try {
      setRows(await api<Row[]>(path));
    } catch (e) {
      setError(message(e));
    }
  }, [path]);
  useEffect(() => {
    void reload();
  }, [reload]);
  async function route(row: Row, enabled: boolean, canonical = false) {
    setError('');
    try {
      const result = await api<{ message: string }>(path + '/' + row.id + '/routing', {
        method: 'POST',
        body: JSON.stringify({ enabled, canonical }),
      });
      setStatus(result.message);
      await reload();
    } catch (e) {
      setError(message(e));
    }
  }
  return (
    <section className="card">
      <h2>Custom domain routing</h2>
      <p>
        Verify ownership above, retain the TXT record, then point a CNAME to the operator&apos;s
        configured ingress. TLS is issued for verified active domains.
      </p>
      <Notice error={error} status={status} />
      {rows.length === 0 && <p>Add and verify a domain to enable routing.</p>}
      {rows.map((row) => (
        <article key={String(row.id)} className="stack">
          <h3>{String(row.domain)}</h3>
          <p>
            {String(row.routing_state)}
            {row.canonical ? ' · Canonical domain' : ''}
          </p>
          <div className="actions">
            <button className="button secondary" onClick={() => route(row, !row.custom_enabled)}>
              {row.custom_enabled ? 'Disable routing' : 'Enable routing'}
            </button>
            {Boolean(row.custom_enabled) && (
              <button className="button secondary" onClick={() => route(row, true, true)}>
                Use as canonical domain
              </button>
            )}
            <button
              className="button secondary"
              onClick={async () => {
                try {
                  const result = await api<{ value: string }>(path + '/' + row.id + '/restart', {
                    method: 'POST',
                  });
                  setStatus('Previous proof invalidated. New TXT value: ' + result.value);
                  await reload();
                } catch (e) {
                  setError(message(e));
                }
              }}
            >
              Restart ownership proof
            </button>
          </div>
        </article>
      ))}
    </section>
  );
}
