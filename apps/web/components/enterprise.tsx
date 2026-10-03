'use client';
import { useLocale } from '../lib/locale-context';
import { useEffect, useState, type FormEvent } from 'react';
import { api, message } from '../lib/api';
import { publicPolicy, privatePolicy } from '../../../packages/contracts/src/index';
import type { Identity } from './dashboard';
interface Assertion {
  id: string;
  key: string;
  value: unknown;
  state: string;
  issuer_handle?: string;
  subject_id: string;
  expires_at: string;
}
export function EnterprisePanel({ identity }: { identity: Identity }) {
  const { formatDate } = useLocale();

  const [incoming, setIncoming] = useState<Assertion[]>([]),
    [outgoing, setOutgoing] = useState<Assertion[]>([]),
    [error, setError] = useState(''),
    [status, setStatus] = useState('');
  const canIssue =
    ['ORGANIZATION', 'TEAM', 'COMMUNITY'].includes(identity.type) &&
    ['OWNER', 'ADMIN', 'HR_MANAGER'].includes(identity.role);
  async function reload() {
    setIncoming(await api('/identities/' + identity.id + '/assertions'));
    if (canIssue) setOutgoing(await api('/organizations/' + identity.id + '/assertions'));
  }
  useEffect(() => {
    void reload().catch((e) => setError(message(e)));
  }, [identity.id]);
  async function action(path: string, body: unknown) {
    setError('');
    try {
      const r = await api<{ message: string }>(path, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      await reload();
      setStatus(r.message);
    } catch (e) {
      setError(message(e));
    }
  }
  async function issue(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    try {
      await api('/organizations/' + identity.id + '/assertions', {
        method: 'POST',
        body: JSON.stringify({
          subjectId: f.get('subject'),
          key: f.get('key'),
          value: f.get('value'),
          expiresAt: new Date(String(f.get('expiry'))).toISOString(),
        }),
      });
      await reload();
      setStatus('Assertion sent. The recipient chooses whether and how to publish it.');
    } catch (e) {
      setError(message(e));
    }
  }
  return (
    <div className="stack">
      <div className="page-heading">
        <span className="eyebrow">ORGANIZATION ASSERTIONS</span>
        <h1>Claims with a clear issuer.</h1>
        <p>You control publication. The issuing organization controls its assertion and expiry.</p>
      </div>
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
      <article className="card stack">
        <h2>Assertions received</h2>
        {!incoming.length && <p className="muted">No organization assertions yet.</p>}
        {incoming.map((a) => (
          <div key={a.id} className="stack list-row">
            <div>
              <strong>
                {a.key}: {String(a.value)}
              </strong>
              <small>
                Issuer @{a.issuer_handle} · {a.state.toLowerCase()} · expires{' '}
                {formatDate(a.expires_at, true)}
              </small>
            </div>
            {identity.role === 'OWNER' && ['PENDING', 'ACCEPTED'].includes(a.state) && (
              <div className="actions">
                <button
                  className="button secondary"
                  onClick={() =>
                    action('/identities/' + identity.id + '/assertions/' + a.id + '/accept', {
                      policy: privatePolicy,
                    })
                  }
                >
                  Accept privately
                </button>
                <button
                  className="button secondary"
                  onClick={() =>
                    action('/identities/' + identity.id + '/assertions/' + a.id + '/accept', {
                      policy: publicPolicy,
                    })
                  }
                >
                  Publish assertion
                </button>
                <button
                  className="button secondary"
                  onClick={() =>
                    action('/identities/' + identity.id + '/assertions/' + a.id + '/dispute', {
                      reason: 'Recipient disputes this assertion.',
                    })
                  }
                >
                  Dispute
                </button>
              </div>
            )}
          </div>
        ))}
      </article>
      {canIssue && (
        <>
          <form method="post" onSubmit={issue} className="card stack narrow-form">
            <h2>Issue an assertion</h2>
            <label>
              Recipient identity ID
              <input name="subject" required pattern="idn_[a-f0-9]{32}" />
            </label>
            <label>
              Assertion field
              <select name="key">
                {[
                  'professional:employer',
                  'professional:job_title',
                  'org:department',
                  'org:employment',
                  'org:membership',
                  'org:certification',
                  'org:education',
                  'org:project_role',
                ].map((k) => (
                  <option value={k} key={k}>
                    {k}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Assertion value
              <input name="value" required maxLength={300} />
              <span className="field-hint">
                Employment status accepts ACTIVE, ON_LEAVE, or ENDED.
              </span>
            </label>
            <label>
              Expiry date
              <input type="date" name="expiry" required />
            </label>
            <button className="button primary">Send assertion for recipient review</button>
          </form>
          <article className="card stack">
            <h2>Assertions issued</h2>
            {outgoing.map((a) => (
              <div className="list-row" key={a.id}>
                <div>
                  <strong>
                    {a.key}: {String(a.value)}
                  </strong>
                  <small>
                    {a.subject_id} · {a.state.toLowerCase()}
                  </small>
                </div>
                {a.state !== 'REVOKED' && (
                  <button
                    className="button secondary"
                    onClick={() =>
                      action(
                        '/organizations/' + identity.id + '/assertions/' + a.id + '/revoke',
                        {},
                      )
                    }
                  >
                    Revoke assertion
                  </button>
                )}
              </div>
            ))}
          </article>
        </>
      )}
    </div>
  );
}
