'use client';
import { useLocale } from '../lib/locale-context';
import { OAuthClients } from './oauth-clients';
import { useState, useEffect, useCallback, type FormEvent } from 'react';
import { startRegistration } from '@simplewebauthn/browser';
import { api, message } from '../lib/api';
import { scopes, claimKeys, roleTypes } from '../../../packages/contracts/src/index';
import type { Identity, Account } from './dashboard';
function useRows<T>(path: string) {
  const [rows, setRows] = useState<T[]>([]),
    [error, setError] = useState('');
  const reload = useCallback(async () => {
    try {
      setRows(await api<T[]>(path));
      setError('');
    } catch (e) {
      setError(message(e));
    }
  }, [path]);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { rows, error, setError, reload };
}
function Notice({ error, status }: { error: string; status?: string }) {
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
function Heading({ label, title, copy }: { label: string; title: string; copy: string }) {
  return (
    <div className="page-heading">
      <span className="eyebrow">{label}</span>
      <h1>{title}</h1>
      <p>{copy}</p>
    </div>
  );
}
interface Application {
  id: string;
  name: string;
  purpose: string;
  revoked_at: string | null;
}
interface Consent {
  id: string;
  name: string;
  purpose: string;
  scopes: string[];
  fields: string[];
  expires_at: string;
  last_access_at: string | null;
  revoked_at: string | null;
}
export function ApplicationsPanel({ identity }: { identity: Identity }) {
  const { formatDate } = useLocale();

  const apps = useRows<Application>('/applications'),
    consents = useRows<Consent>('/identities/' + identity.id + '/consents');
  const [status, setStatus] = useState(''),
    [credential, setCredential] = useState(''),
    [webhookApp, setWebhookApp] = useState('');
  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    try {
      const result = await api<{ apiKey: string }>('/applications', {
        method: 'POST',
        body: JSON.stringify({ name: f.get('name'), purpose: f.get('purpose') }),
      });
      setCredential(result.apiKey);
      setStatus('Application created. Store this credential before dismissing it.');
      await apps.reload();
    } catch (e) {
      apps.setError(message(e));
    }
  }
  async function grant(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    try {
      const result = await api<{ token: string }>('/identities/' + identity.id + '/consents', {
        method: 'POST',
        body: JSON.stringify({
          applicationId: f.get('applicationId'),
          scopes: f.getAll('scopes'),
          fields: f.getAll('fields'),
        }),
      });
      setCredential(result.token);
      setStatus(
        'Access granted for 30 days. The token returns only allowed fields that also permit API access.',
      );
      await consents.reload();
    } catch (e) {
      apps.setError(message(e));
    }
  }
  async function revokeConsent(id: string) {
    try {
      await api('/identities/' + identity.id + '/consents/' + id, { method: 'DELETE' });
      await consents.reload();
      setStatus('Application access revoked immediately.');
    } catch (e) {
      apps.setError(message(e));
    }
  }
  async function revokeApp(id: string) {
    try {
      await api('/applications/' + id, { method: 'DELETE' });
      await apps.reload();
      await consents.reload();
      setStatus('Application and all its access tokens revoked.');
    } catch (e) {
      apps.setError(message(e));
    }
  }
  async function webhook(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    try {
      const result = await api<{ secret: string }>('/applications/' + webhookApp + '/webhooks', {
        method: 'POST',
        body: JSON.stringify({
          url: f.get('url'),
          events: String(f.get('events'))
            .split(',')
            .map((s) => s.trim()),
        }),
      });
      setCredential(result.secret);
      setStatus('Webhook registered. Use this secret to verify signed deliveries.');
    } catch (e) {
      apps.setError(message(e));
    }
  }
  return (
    <div className="stack">
      <Heading
        label="APPLICATIONS"
        title="Your identity. Their permission."
        copy="Grant access to specific fields and take it back whenever you choose."
      />
      <Notice error={apps.error || consents.error} status={status} />
      {credential && (
        <article className="card secret-card">
          <h2>Save this credential</h2>
          <p className="muted">
            It is shown here once. Keep it out of public code and screenshots.
          </p>
          <label>
            Credential
            <input readOnly value={credential} onFocus={(e) => e.target.select()} />
          </label>
          <button className="button secondary" onClick={() => setCredential('')}>
            I have saved it
          </button>
        </article>
      )}
      <article className="card">
        <h2>Applications using this identity</h2>
        {consents.rows.length === 0 ? (
          <p className="muted">No applications have access yet.</p>
        ) : (
          consents.rows.map((c) => (
            <div className="list-row" key={c.id}>
              <div>
                <strong>{c.name}</strong>
                <small>
                  {c.scopes.join(', ')} ·{' '}
                  {c.revoked_at ? 'Revoked' : 'Expires ' + formatDate(c.expires_at, true)}
                </small>
                <small>{c.fields.join(', ')}</small>
                <small>
                  Last access: {c.last_access_at ? formatDate(c.last_access_at) : 'Never'}
                </small>
              </div>
              {!c.revoked_at && (
                <button className="button secondary compact" onClick={() => revokeConsent(c.id)}>
                  Revoke
                </button>
              )}
            </div>
          ))
        )}
      </article>
      <OAuthClients reload={apps.reload} />
      <div className="editor-grid">
        <form method="post" className="card stack" onSubmit={grant}>
          <h2>Grant granular access</h2>
          <label>
            Application ID
            <input name="applicationId" required placeholder="app_…" />
            <span className="field-hint">Use the application ID supplied by its developer.</span>
          </label>
          <fieldset className="checkbox-grid">
            <legend>Scopes</legend>
            {scopes.map((s) => (
              <label className="check" key={s}>
                <input
                  name="scopes"
                  value={s}
                  type="checkbox"
                  defaultChecked={s === 'identity.read' || s === 'profile.basic'}
                />
                {s}
              </label>
            ))}
          </fieldset>
          <fieldset className="checkbox-grid">
            <legend>Fields</legend>
            {claimKeys.map((k) => (
              <label className="check" key={k}>
                <input
                  name="fields"
                  value={k}
                  type="checkbox"
                  defaultChecked={k === 'core:display_name'}
                />
                {k}
              </label>
            ))}
          </fieldset>
          <button className="button primary">Grant access for 30 days</button>
        </form>
        <div className="stack">
          <form method="post" className="card stack" onSubmit={create}>
            <h2>Register an application</h2>
            <label>
              Application name
              <input name="name" required maxLength={100} />
            </label>
            <label>
              Purpose
              <textarea name="purpose" required maxLength={500} rows={3} />
            </label>
            <button className="button secondary">Create application</button>
          </form>
          <article className="card">
            <h2>Your developer applications</h2>
            {apps.rows.length === 0 ? (
              <p className="muted">Create an application to get started.</p>
            ) : (
              apps.rows.map((a) => (
                <div className="list-row" key={a.id}>
                  <div>
                    <strong>{a.name}</strong>
                    <small className="mono">{a.id}</small>
                  </div>
                  {!a.revoked_at && (
                    <button className="button secondary compact" onClick={() => revokeApp(a.id)}>
                      Revoke app
                    </button>
                  )}
                </div>
              ))
            )}
          </article>
        </div>
      </div>
      <form method="post" className="card stack narrow-form" onSubmit={webhook}>
        <h2>Signed webhooks</h2>
        <label>
          Application
          <select value={webhookApp} onChange={(e) => setWebhookApp(e.target.value)} required>
            <option value="">Choose application</option>
            {apps.rows
              .filter((a) => !a.revoked_at)
              .map((a) => (
                <option value={a.id} key={a.id}>
                  {a.name}
                </option>
              ))}
          </select>
        </label>
        <label>
          Public HTTPS destination
          <input
            name="url"
            type="url"
            required
            placeholder="https://your-service.example/webhook"
          />
        </label>
        <label>
          Events, comma separated
          <input
            name="events"
            defaultValue="identity.updated,claim.updated,avatar.updated"
            required
          />
        </label>
        <button className="button secondary">Register webhook</button>
      </form>
    </div>
  );
}
export function OrganizationPanel({ identity }: { identity: Identity }) {
  const data = useRows<{ account_id: string; email: string; role: string }>(
    '/identities/' + identity.id + '/members',
  );
  const [status, setStatus] = useState('');
  async function invite(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    try {
      const r = await api<{ message: string }>('/identities/' + identity.id + '/invitations', {
        method: 'POST',
        body: JSON.stringify({ email: f.get('email'), role: f.get('role') }),
      });
      setStatus(r.message);
    } catch (e) {
      data.setError(message(e));
    }
  }
  async function remove(id: string) {
    try {
      await api('/identities/' + identity.id + '/members/' + id, { method: 'DELETE' });
      await data.reload();
      setStatus('Access removed.');
    } catch (e) {
      data.setError(message(e));
    }
  }
  return (
    <div className="stack">
      <Heading
        label="PEOPLE & ROLES"
        title="Share the work. Keep control."
        copy="Delegate specific permissions without sharing your account."
      />
      <Notice error={data.error} status={status} />
      <article className="card">
        <h2>Identity managers</h2>
        {data.rows.map((m) => (
          <div className="list-row" key={m.account_id}>
            <div>
              <strong>{m.email}</strong>
              <small>{m.role.toLowerCase().replaceAll('_', ' ')}</small>
            </div>
            {m.role !== 'OWNER' && (
              <button className="button secondary compact" onClick={() => remove(m.account_id)}>
                Remove
              </button>
            )}
          </div>
        ))}
      </article>
      <form method="post" className="card stack narrow-form" onSubmit={invite}>
        <h2>Invite a manager</h2>
        <label>
          Email address
          <input name="email" type="email" required />
        </label>
        <label>
          Role
          <select name="role" defaultValue="EDITOR">
            {roleTypes
              .filter((r) => r !== 'OWNER')
              .map((r) => (
                <option value={r} key={r}>
                  {r.toLowerCase().replaceAll('_', ' ')}
                </option>
              ))}
          </select>
        </label>
        <p className="muted small">
          Invitations expire after seven days and must be accepted by the matching verified account.
        </p>
        <button className="button primary">Send invitation</button>
      </form>
    </div>
  );
}
export function DomainsPanel({ identity }: { identity: Identity }) {
  const { formatDate } = useLocale();

  const data = useRows<{
    id: string;
    domain: string;
    method: string;
    verified_at: string | null;
    expires_at: string;
    revoked_at: string | null;
    challenge_value: string;
  }>('/identities/' + identity.id + '/domains');
  const [status, setStatus] = useState('');
  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    try {
      const d = await api<{ location: string; value: string }>(
        '/identities/' + identity.id + '/domains',
        {
          method: 'POST',
          body: JSON.stringify({ domain: f.get('domain'), method: f.get('method') }),
        },
      );
      await data.reload();
      setStatus('Publish ' + d.value + ' at ' + d.location + ', then verify.');
    } catch (e) {
      data.setError(message(e));
    }
  }
  async function verify(id: string) {
    try {
      const d = await api<{ message: string }>(
        '/identities/' + identity.id + '/domains/' + id + '/verify',
        { method: 'POST', body: '{}' },
      );
      await data.reload();
      setStatus(d.message);
    } catch (e) {
      data.setError(message(e));
    }
  }
  async function revoke(id: string) {
    try {
      await api('/identities/' + identity.id + '/domains/' + id, { method: 'DELETE' });
      await data.reload();
      setStatus('Domain claim revoked.');
    } catch (e) {
      data.setError(message(e));
    }
  }
  return (
    <div className="stack">
      <Heading
        label="VERIFICATION"
        title="Evidence for a specific claim."
        copy="Prove control of a domain. Verification expires and never implies global trustworthiness."
      />
      <Notice error={data.error} status={status} />
      <article className="card">
        <h2>Domain claims</h2>
        {data.rows.length === 0 ? (
          <p className="muted">No domain ownership claims yet.</p>
        ) : (
          data.rows.map((d) => (
            <div className="domain-row" key={d.id}>
              <div>
                <strong>{d.domain}</strong>
                <small>
                  {d.revoked_at
                    ? 'Revoked'
                    : new Date(d.expires_at).getTime() < Date.now()
                      ? 'Expired'
                      : d.verified_at
                        ? 'Verified until ' + formatDate(d.expires_at, true)
                        : 'Awaiting proof'}{' '}
                  · {d.method}
                </small>
                <code>{d.challenge_value}</code>
              </div>
              {!d.revoked_at && (
                <div className="actions">
                  <button className="button secondary compact" onClick={() => verify(d.id)}>
                    Verify
                  </button>
                  <button className="button secondary compact" onClick={() => revoke(d.id)}>
                    Revoke
                  </button>
                </div>
              )}
            </div>
          ))
        )}
      </article>
      <form method="post" className="card stack narrow-form" onSubmit={create}>
        <h2>Verify a domain</h2>
        <label>
          Domain
          <input name="domain" required placeholder="example.com" maxLength={253} />
        </label>
        <label>
          Method
          <select name="method">
            <option value="DNS">DNS TXT record</option>
            <option value="WELL_KNOWN">Well-known HTTPS resource</option>
          </select>
        </label>
        <button className="button primary">Create challenge</button>
      </form>
    </div>
  );
}
export function SecurityPanel({ account }: { account: Account }) {
  const { formatDate } = useLocale();

  const [mfaEnabled, setMfaEnabled] = useState(account.totp_enabled);
  const sessions = useRows<{ id: string; device: string; created_at: string; expires_at: string }>(
      '/auth/sessions',
    ),
    keys = useRows<{ id: string; name: string; created_at: string }>('/auth/passkeys');
  const [password, setPassword] = useState(''),
    [securityCode, setSecurityCode] = useState('');
  async function proof() {
    const p = await api<{ proof: string }>('/auth/stepup', {
      method: 'POST',
      body: JSON.stringify({ password, ...(securityCode ? { code: securityCode } : {}) }),
    });
    return p.proof;
  }
  const [status, setStatus] = useState(''),
    [totp, setTotp] = useState<{ token: string; uri: string } | null>(null),
    [codes, setCodes] = useState<string[]>([]);
  async function addPasskey() {
    try {
      const d = await api<{
        token: string;
        options: Parameters<typeof startRegistration>[0]['optionsJSON'];
      }>('/auth/passkeys/registration/options', {
        method: 'POST',
        body: JSON.stringify({ proof: await proof() }),
      });
      const response = await startRegistration({ optionsJSON: d.options });
      await api('/auth/passkeys/registration/verify', {
        method: 'POST',
        body: JSON.stringify({ token: d.token, response, name: 'My passkey' }),
      });
      await keys.reload();
      setStatus('Passkey added. You can now use it to sign in.');
    } catch (e) {
      sessions.setError(message(e));
    }
  }
  async function removeKey(id: string) {
    try {
      await api('/auth/passkeys/' + encodeURIComponent(id), {
        method: 'DELETE',
        body: JSON.stringify({ proof: await proof() }),
      });
      await keys.reload();
      setStatus('Passkey removed.');
    } catch (e) {
      sessions.setError(message(e));
    }
  }
  async function revoke(id: string) {
    try {
      await api('/auth/sessions/' + id, { method: 'DELETE' });
      await sessions.reload();
      setStatus('Session revoked.');
    } catch (e) {
      sessions.setError(message(e));
    }
  }
  async function setup() {
    try {
      setTotp(
        await api('/auth/totp/setup', {
          method: 'POST',
          body: JSON.stringify({ proof: await proof() }),
        }),
      );
    } catch (e) {
      sessions.setError(message(e));
    }
  }
  async function confirm(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    try {
      const d = await api<{ backupCodes: string[] }>('/auth/totp/confirm', {
        method: 'POST',
        body: JSON.stringify({
          token: totp?.token,
          code: new FormData(e.currentTarget).get('code'),
        }),
      });
      setCodes(d.backupCodes);
      setMfaEnabled(true);
      setSecurityCode('');
      setTotp(null);
      setStatus('Authenticator enabled. Store your backup codes securely.');
    } catch (e) {
      sessions.setError(message(e));
    }
  }
  return (
    <div className="stack">
      <Heading
        label="SECURITY"
        title="Protect your home."
        copy="Use a passkey, add an authenticator, and review your active sessions."
      />
      <Notice error={sessions.error || keys.error} status={status} />
      <article className="card stack narrow-form">
        <h2>Confirm security changes</h2>
        <p className="muted">
          Confirm your password before adding or removing a passkey or changing your authenticator.
        </p>
        <label>
          Confirm password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
        </label>
        {mfaEnabled && (
          <label>
            Current security or backup code
            <input
              value={securityCode}
              onChange={(e) => setSecurityCode(e.target.value)}
              autoComplete="one-time-code"
            />
          </label>
        )}
      </article>
      <article className="card">
        <div className="between">
          <h2>Passkeys</h2>
          <button className="button primary compact" onClick={addPasskey}>
            Add a passkey
          </button>
        </div>
        {keys.rows.length === 0 ? (
          <p className="muted">No passkeys added. Use your device to create one.</p>
        ) : (
          keys.rows.map((k) => (
            <div className="list-row" key={k.id}>
              <div>
                <strong>{k.name}</strong>
                <small>Added {formatDate(k.created_at, true)}</small>
              </div>
              <button className="button secondary compact" onClick={() => removeKey(k.id)}>
                Remove
              </button>
            </div>
          ))
        )}
      </article>
      <article className="card stack">
        <h2>Authenticator app</h2>
        <p className="muted">
          {mfaEnabled
            ? 'An authenticator is enabled for your account.'
            : 'Add six-digit security codes to password sign-in.'}
        </p>
        {!mfaEnabled && !totp && (
          <button className="button secondary" onClick={setup}>
            Set up authenticator
          </button>
        )}
        {totp && (
          <form method="post" className="stack" onSubmit={confirm}>
            <label>
              Setup URI — import into your authenticator
              <input readOnly value={totp.uri} onFocus={(e) => e.target.select()} />
            </label>
            <label>
              Six-digit code
              <input
                name="code"
                inputMode="numeric"
                pattern="[0-9]{6}"
                autoComplete="one-time-code"
                required
              />
            </label>
            <button className="button primary">Confirm authenticator</button>
          </form>
        )}
        {codes.length > 0 && (
          <div className="stack">
            <h3>Your single-use backup codes</h3>
            <pre>{codes.join('\n')}</pre>
            <button className="button secondary" onClick={() => setCodes([])}>
              I have stored my codes
            </button>
          </div>
        )}
      </article>
      <article className="card">
        <h2>Active sessions</h2>
        {sessions.rows.map((s) => (
          <div className="list-row" key={s.id}>
            <div>
              <strong>{s.device}</strong>
              <small>
                Started {formatDate(s.created_at)} · expires {formatDate(s.expires_at, true)}
              </small>
            </div>
            <button className="button secondary compact" onClick={() => revoke(s.id)}>
              Revoke session
            </button>
          </div>
        ))}
      </article>
    </div>
  );
}
export function ExportPanel({ identity }: { identity: Identity }) {
  const { formatDate } = useLocale();

  const data = useRows<{ id: string; status: string; created_at: string; expires_at: string }>(
    '/identities/' + identity.id + '/exports',
  );
  const [status, setStatus] = useState(''),
    [qr, setQr] = useState<{ url: string; svg: string } | null>(null);
  async function create() {
    try {
      await api('/identities/' + identity.id + '/exports', { method: 'POST', body: '{}' });
      await data.reload();
      setStatus('Export queued. Refresh the list after the worker finishes.');
    } catch (e) {
      data.setError(message(e));
    }
  }
  async function download(id: string, format = 'json') {
    try {
      const d = await api<{ url: string }>('/exports/' + id + '/download?format=' + format);
      window.location.assign(d.url);
    } catch (e) {
      data.setError(message(e));
    }
  }
  async function createQr() {
    try {
      setQr(await api('/identities/' + identity.id + '/qr', { method: 'POST', body: '{}' }));
    } catch (e) {
      data.setError(message(e));
    }
  }
  async function remove(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    try {
      await api('/identities/' + identity.id, {
        method: 'DELETE',
        body: JSON.stringify({ confirmation: new FormData(e.currentTarget).get('confirmation') }),
      });
      window.location.reload();
    } catch (e) {
      data.setError(message(e));
    }
  }
  return (
    <div className="stack">
      <Heading
        label="EXPORT & SHARING"
        title="Your identity travels with you."
        copy="Download your data or share a profile destination that you control."
      />
      <Notice error={data.error} status={status} />
      <article className="card stack">
        <div className="between">
          <h2>Identity data export</h2>
          <div className="actions">
            <button className="button secondary compact" onClick={() => data.reload()}>
              Refresh
            </button>
            <button className="button primary compact" onClick={create}>
              Create export
            </button>
          </div>
        </div>
        <p className="muted">
          Versioned JSON includes your claims, personas, relationships and settings. The archive
          includes validated media and checksums. Download links expire after one minute.
        </p>
        {data.rows.map((e) => (
          <div className="list-row" key={e.id}>
            <div>
              <strong>{e.status.toLowerCase()}</strong>
              <small>{formatDate(e.created_at)}</small>
            </div>
            {e.status === 'READY' && new Date(e.expires_at).getTime() > Date.now() && (
              <div className="actions">
                <button className="button secondary compact" onClick={() => download(e.id)}>
                  Download JSON
                </button>
                <button
                  className="button secondary compact"
                  onClick={() => download(e.id, 'archive')}
                >
                  Download media archive
                </button>
              </div>
            )}
          </div>
        ))}
      </article>
      <article className="card stack">
        <h2>Profile QR</h2>
        <p className="muted">
          Your profile privacy still applies to anyone opening this destination.
        </p>
        <button className="button secondary" onClick={createQr}>
          Create profile QR
        </button>
        {qr && (
          <div className="qr-result">
            <img
              src={'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(qr.svg)}
              alt={'QR code linking to ' + qr.url}
              width={180}
              height={180}
            />
            <a href={qr.url}>{qr.url}</a>
          </div>
        )}
        <a href={'/api/v1/profiles/' + identity.id + '/vcard'} className="text-link">
          Download public vCard
        </a>
      </article>
      <form method="post" className="card stack danger-zone narrow-form" onSubmit={remove}>
        <h2>Delete identity</h2>
        <p>
          Claims, profile revisions and application access are removed. Public URLs stop resolving.
          Historical handles stay reserved to prevent impersonation.
        </p>
        <label>
          Type <strong>{identity.handle}</strong> to confirm
          <input name="confirmation" required autoComplete="off" />
        </label>
        <button className="button danger">Delete this identity</button>
      </form>
    </div>
  );
}
export function ActivityPanel({ identity }: { identity: Identity }) {
  const { formatDate } = useLocale();

  const data = useRows<{
    id: string;
    action: string;
    actor_id: string;
    request_id: string;
    created_at: string;
  }>('/identities/' + identity.id + '/audit');
  return (
    <div className="stack">
      <Heading
        label="ACTIVITY"
        title="A clear trail of changes."
        copy="Security and identity mutations record who acted and when."
      />
      <Notice error={data.error} />
      <article className="card">
        <div className="between">
          <h2>Recent activity</h2>
          <button className="button secondary compact" onClick={() => data.reload()}>
            Refresh
          </button>
        </div>
        {data.rows.map((a) => (
          <div className="list-row" key={a.id}>
            <div>
              <strong>{a.action.replaceAll('.', ' · ').replaceAll('_', ' ')}</strong>
              <small>Actor {a.actor_id}</small>
              <small className="mono">Request {a.request_id}</small>
            </div>
            <time dateTime={a.created_at} className="muted small">
              {formatDate(a.created_at)}
            </time>
          </div>
        ))}
      </article>
    </div>
  );
}
