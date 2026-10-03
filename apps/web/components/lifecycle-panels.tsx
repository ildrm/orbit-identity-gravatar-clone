'use client';
import { useState, useEffect, useCallback, type FormEvent } from 'react';
import { api, message } from '../lib/api';
import type { Identity, Account } from './dashboard';
import { useLocale } from '../lib/locale-context';
import { freshProof } from './trust-panels';
type Row = Record<string, unknown>;
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
        <input name="code" autoComplete="one-time-code" maxLength={20} />
      </label>
    </>
  );
}
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
export function AccountPanel({ account }: { account: Account }) {
  const { setPreferences } = useLocale();
  const [error, setError] = useState(''),
    [status, setStatus] = useState(''),
    [preview, setPreview] = useState<Row | null>(null),
    [codes, setCodes] = useState<string[]>([]);
  async function run(e: FormEvent<HTMLFormElement>, action: string) {
    e.preventDefault();
    setError('');
    setStatus('');
    try {
      const f = new FormData(e.currentTarget);
      if (action === 'settings') {
        await api('/account/settings', {
          method: 'PATCH',
          body: JSON.stringify({ locale: f.get('locale'), timezone: f.get('timezone') }),
        });
        setPreferences({ locale: String(f.get('locale')), timezone: String(f.get('timezone')) });
        setStatus('Language and timezone saved.');
        return;
      }
      if (action === 'confirm-email') {
        const result = await api<{ message: string }>('/account/email/confirm', {
          method: 'POST',
          body: JSON.stringify({ token: f.get('token') }),
        });
        setStatus(result.message);
        return;
      }
      const proof = await freshProof(f),
        body: Row = { proof };
      if (action === 'password') body.password = f.get('newPassword');
      if (action === 'email') body.email = f.get('email');
      if (action === 'delete') {
        body.confirmEmail = f.get('confirmation');
        body.deleteOwnedIdentities = true;
      }
      const result = await api<{ message?: string; backupCodes?: string[] }>(
        action === 'delete' ? '/account' : '/account/' + action,
        { method: action === 'delete' ? 'DELETE' : 'POST', body: JSON.stringify(body) },
      );
      setStatus(result.message || 'Account updated.');
      if (result.backupCodes) setCodes(result.backupCodes);
      if (action === 'password' || action === 'delete') window.location.assign('/login');
    } catch (e) {
      setError(message(e));
    }
  }
  return (
    <div className="stack">
      <div className="page-heading">
        <span className="eyebrow">ACCOUNT CONTROLS</span>
        <h1>Account settings</h1>
        <p>Manage language, timezone, verified email and account security.</p>
      </div>
      <Notice error={error} status={status} />
      <section className="card">
        <h2>Language and timezone</h2>
        <form className="form-stack" onSubmit={(e) => run(e, 'settings')}>
          <label>
            Language
            <select name="locale" defaultValue={account.locale}>
              <option value="en">English</option>
              <option value="fa">فارسی</option>
              <option value="ar">العربية</option>
            </select>
          </label>
          <label>
            IANA timezone
            <input name="timezone" defaultValue={account.timezone} required maxLength={100} />
          </label>
          <button className="button primary">Save settings</button>
        </form>
      </section>
      <section className="card">
        <h2>Change password</h2>
        <form className="form-stack" onSubmit={(e) => run(e, 'password')}>
          <Security />
          <label>
            New password
            <input
              name="newPassword"
              type="password"
              autoComplete="new-password"
              minLength={12}
              maxLength={128}
              required
            />
          </label>
          <p>All sessions will be signed out after the change.</p>
          <button className="button primary">Change password</button>
        </form>
      </section>
      <section className="card">
        <h2>Change verified email</h2>
        <p>Current address: {account.email}</p>
        <form className="form-stack" onSubmit={(e) => run(e, 'email')}>
          <label>
            New email
            <input name="email" type="email" autoComplete="email" required maxLength={254} />
          </label>
          <Security />
          <button className="button primary">Send verification</button>
        </form>
        <form className="form-stack" onSubmit={(e) => run(e, 'confirm-email')}>
          <label>
            Verification code from your new inbox
            <input name="token" required maxLength={200} />
          </label>
          <button className="button secondary">Confirm new email</button>
        </form>
      </section>
      {account.totp_enabled && (
        <section className="card">
          <h2>Authenticator controls</h2>
          <form className="form-stack" onSubmit={(e) => run(e, 'backup-codes')}>
            <Security />
            <button className="button secondary">Replace backup codes</button>
          </form>
          {codes.length > 0 && (
            <p role="status">Save these codes securely. Each works once: {codes.join(' · ')}</p>
          )}
          <form className="form-stack" onSubmit={(e) => run(e, 'totp/disable')}>
            <Security />
            <button className="button danger">Disable authenticator</button>
          </form>
        </section>
      )}
      <section className="card">
        <h2>Delete account</h2>
        <p>
          Export your data first. Solely owned identities will be deleted. Shared identities remain
          with their other owners. This action is permanent.
        </p>
        <button
          className="button secondary"
          onClick={async () => {
            try {
              setPreview(await api<Row>('/account/deletion-preview'));
            } catch (e) {
              setError(message(e));
            }
          }}
        >
          Review affected identities
        </button>
        {preview && (
          <pre>
            <code>{JSON.stringify(preview, null, 2)}</code>
          </pre>
        )}
        <form className="form-stack" onSubmit={(e) => run(e, 'delete')}>
          <label>
            Type your current email to confirm
            <input name="confirmation" type="email" required maxLength={254} />
          </label>
          <Security />
          <label className="check">
            <input type="checkbox" required />
            Delete my account and solely owned identities
          </label>
          <button className="button danger">Permanently delete account</button>
        </form>
      </section>
    </div>
  );
}
export function LegacyPanel({ identity }: { identity: Identity }) {
  const path = '/identities/' + identity.id + '/legacy',
    [policy, setPolicy] = useState<Row | null>(null),
    [requests, setRequests] = useState<Row[]>([]),
    [custodianships, setCustodianships] = useState<Row[]>([]),
    [error, setError] = useState(''),
    [status, setStatus] = useState('');
  const reload = useCallback(async () => {
    try {
      const [p, c] = await Promise.all([
        api<{ policy: Row | null; requests: Row[] }>(path),
        api<Row[]>('/legacy/custodianships'),
      ]);
      setPolicy(p.policy);
      setRequests(p.requests);
      setCustodianships(c);
    } catch (e) {
      setError(message(e));
    }
  }, [path]);
  useEffect(() => {
    void reload();
  }, [reload]);
  async function configure(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError('');
    try {
      const f = new FormData(e.currentTarget),
        proof = await freshProof(f);
      const result = await api<{ message: string }>(path, {
        method: 'PUT',
        body: JSON.stringify({ custodianEmail: f.get('email'), outcome: f.get('outcome'), proof }),
      });
      setStatus(result.message);
      await reload();
    } catch (e) {
      setError(message(e));
    }
  }
  async function veto(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError('');
    try {
      const proof = await freshProof(new FormData(e.currentTarget));
      const result = await api<{ message: string }>(path + '/veto', {
        method: 'POST',
        body: JSON.stringify({ proof }),
      });
      setStatus(result.message);
      await reload();
    } catch (e) {
      setError(message(e));
    }
  }
  async function request(e: FormEvent<HTMLFormElement>, identityId: string) {
    e.preventDefault();
    setError('');
    try {
      const f = new FormData(e.currentTarget),
        proof = await freshProof(f);
      const result = await api<{ message: string }>('/legacy/' + identityId + '/request', {
        method: 'POST',
        body: JSON.stringify({ evidence: f.get('evidence'), proof }),
      });
      setStatus(result.message);
      await reload();
    } catch (e) {
      setError(message(e));
    }
  }
  return (
    <div className="stack">
      <div className="page-heading">
        <span className="eyebrow">OPTIONAL DIGITAL LEGACY</span>
        <h1>Legacy policy</h1>
        <p>
          Nominate a custodian and explicitly choose an outcome. Inactivity never triggers an
          action.
        </p>
      </div>
      <Notice error={error} status={status} />
      <section className="card">
        <h2>Your policy</h2>
        {policy ? (
          <p>
            Outcome: {String(policy.outcome)} · Version {String(policy.version)} ·{' '}
            {policy.revoked_at
              ? 'Revoked'
              : policy.accepted_at
                ? 'Custodian accepted'
                : 'Awaiting custodian acceptance'}
          </p>
        ) : (
          <p>No legacy policy configured.</p>
        )}
        <form className="form-stack" onSubmit={configure}>
          <label>
            Custodian&apos;s verified account email
            <input name="email" type="email" required maxLength={254} />
          </label>
          <label>
            Outcome
            <select name="outcome">
              <option value="MEMORIALIZE">Memorialize</option>
              <option value="FREEZE">Freeze</option>
              <option value="TRANSFER_TO_CUSTODIAN">Transfer to custodian</option>
              <option value="ARCHIVE">Archive privately</option>
              <option value="DELETE">Delete permanently</option>
            </select>
          </label>
          <Security />
          <button className="button primary">Save explicit policy</button>
        </form>
      </section>
      <section className="card">
        <h2>Pending requests and veto</h2>
        <p>
          A request notifies you, waits 30 days, and requires two independent moderator approvals.
          You can revoke the policy and veto pending requests.
        </p>
        {requests.map((q) => (
          <p key={String(q.id)}>
            {String(q.id)} · {String(q.state)} · Earliest action {String(q.not_before)}
          </p>
        ))}
        <form className="form-stack" onSubmit={veto}>
          <Security />
          <button className="button danger">Revoke policy and veto requests</button>
        </form>
      </section>
      <section className="card">
        <h2>Custodianships offered to you</h2>
        {custodianships.length === 0 && <p>No active custodianships.</p>}
        {custodianships.map((c) => (
          <article key={String(c.identity_id)} className="stack">
            <h3>{String(c.identity_id)}</h3>
            <p>
              Outcome {String(c.outcome)}. Custodianship grants no current profile editing access.
            </p>
            {!c.accepted_at ? (
              <button
                className="button secondary"
                onClick={async () => {
                  try {
                    await api('/legacy/' + c.identity_id + '/accept', { method: 'POST' });
                    await reload();
                  } catch (e) {
                    setError(message(e));
                  }
                }}
              >
                Accept custodianship
              </button>
            ) : (
              <form className="form-stack" onSubmit={(e) => request(e, String(c.identity_id))}>
                <label>
                  Evidence for independent reviewers
                  <textarea name="evidence" required minLength={100} maxLength={10000} rows={5} />
                </label>
                <Security />
                <button className="button secondary">Request verified legacy action</button>
              </form>
            )}
          </article>
        ))}
      </section>
    </div>
  );
}
