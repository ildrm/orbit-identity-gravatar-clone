'use client';
import { useState, type FormEvent } from 'react';
import { api, message } from '../lib/api';
import type { Identity } from './dashboard';
export function MergePanel({ identity }: { identity: Identity }) {
  const [target, setTarget] = useState(''),
    [preview, setPreview] = useState<{
      target: { id: string; handle: string };
      effects: string[];
      conflicts: { key: string }[];
    } | null>(null),
    [error, setError] = useState(''),
    [ticket, setTicket] = useState(''),
    [status, setStatus] = useState('');
  async function review(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError('');
    try {
      setPreview(
        await api(
          '/identities/' + identity.id + '/merge-preview?target=' + encodeURIComponent(target),
        ),
      );
    } catch (e) {
      setError(message(e));
    }
  }
  async function merge(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setError('');
    try {
      const { proof } = await api<{ proof: string }>('/auth/stepup', {
        method: 'POST',
        body: JSON.stringify({
          password: f.get('password'),
          ...(f.get('code') ? { code: f.get('code') } : {}),
        }),
      });
      await api('/identities/' + identity.id + '/merge', {
        method: 'POST',
        body: JSON.stringify({
          targetId: preview?.target.id,
          sourceConfirmation: f.get('source'),
          targetConfirmation: f.get('target'),
          proof,
        }),
      });
      window.location.assign('/dashboard');
    } catch (e) {
      setError(message(e));
    }
  }
  async function accountMerge(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget),
      create = f.get('operation') === 'ticket';
    setError('');
    try {
      const { proof } = await api<{ proof: string }>('/auth/stepup', {
        method: 'POST',
        body: JSON.stringify({
          password: f.get('password'),
          ...(f.get('code') ? { code: f.get('code') } : {}),
        }),
      });
      if (create) {
        const result = await api<{ ticket: string }>('/auth/merge-ticket', {
          method: 'POST',
          body: JSON.stringify({ proof, targetEmail: f.get('email') }),
        });
        setTicket(result.ticket);
        setStatus(
          'Save the ticket, sign out, and sign into the destination account. The ticket expires in ten minutes.',
        );
      } else {
        await api('/auth/merge', {
          method: 'POST',
          body: JSON.stringify({
            proof,
            ticket: f.get('ticket'),
            confirmation: f.get('confirmation'),
          }),
        });
        window.location.assign('/login');
      }
    } catch (e) {
      setError(message(e));
    }
  }
  const authFields = (
    <>
      <label>
        Current password
        <input name="password" type="password" required autoComplete="current-password" />
      </label>
      <label>
        Security or backup code, if enabled
        <input name="code" maxLength={20} autoComplete="one-time-code" />
      </label>
    </>
  );
  return (
    <div className="stack">
      <div className="page-heading">
        <span className="eyebrow">MERGING</span>
        <h1>Bring identities together.</h1>
        <p>
          Prove control, review the effects, and confirm both handles. Merges preserve permanent
          references.
        </p>
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
      {identity.role === 'OWNER' && (
        <form method="post" onSubmit={review} className="card stack narrow-form">
          <h2>Review an identity merge</h2>
          <p>Merge @{identity.handle} into another identity you own.</p>
          <label>
            Destination identity ID
            <input
              value={target}
              onChange={(e) => {
                setTarget(e.target.value);
                setPreview(null);
              }}
              required
              pattern="idn_[a-f0-9]{32}"
            />
          </label>
          <button className="button secondary">Review effects</button>
        </form>
      )}
      {preview && (
        <form method="post" onSubmit={merge} className="card stack narrow-form danger-zone">
          <h2>Merge into @{preview.target.handle}</h2>
          <ul>
            {preview.effects.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
          <p>
            Conflicting fields: {preview.conflicts.map((c) => c.key).join(', ') || 'None'}. The
            destination values remain selected.
          </p>
          <label>
            Type source handle
            <input name="source" required placeholder={identity.handle} />
          </label>
          <label>
            Type destination handle
            <input name="target" required placeholder={preview.target.handle} />
          </label>
          {authFields}
          <button className="button danger">Confirm identity merge</button>
        </form>
      )}
      <form method="post" onSubmit={accountMerge} className="card stack narrow-form">
        <h2>Prove control of the source account</h2>
        <input name="operation" type="hidden" value="ticket" />
        <label>
          Destination account email
          <input type="email" name="email" required />
        </label>
        {authFields}
        <button className="button secondary">Create account merge ticket</button>
        {ticket && (
          <label>
            Single-use merge ticket
            <input readOnly value={ticket} />
          </label>
        )}
      </form>
      <form method="post" onSubmit={accountMerge} className="card stack narrow-form danger-zone">
        <h2>Complete an account merge</h2>
        <p>
          Use this while signed into the destination account. Memberships and applications transfer.
          Existing sessions and OAuth grants are revoked; source passkeys are removed. The
          destination account keeps its security settings.
        </p>
        <input name="operation" type="hidden" value="complete" />
        <label>
          Source account ticket
          <input name="ticket" required maxLength={200} />
        </label>
        <label>
          Type MERGE ACCOUNTS
          <input name="confirmation" required />
        </label>
        {authFields}
        <button className="button danger">Merge accounts</button>
      </form>
    </div>
  );
}
