'use client';
import { useState, type FormEvent } from 'react';
import { api, message } from '../lib/api';
import { freshProof } from './trust-panels';
import type { Identity } from './dashboard';
function Security() {
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
export function FederationMigration({ identity }: { identity: Identity }) {
  const path = '/identities/' + identity.id + '/federation/migration',
    [error, setError] = useState(''),
    [status, setStatus] = useState(''),
    [challenge, setChallenge] = useState<{ source: string; target: string; nonce: string } | null>(
      null,
    ),
    [acceptance, setAcceptance] = useState('');
  async function run(e: FormEvent<HTMLFormElement>, action: string) {
    e.preventDefault();
    setError('');
    try {
      const f = new FormData(e.currentTarget);
      if (action === 'challenge') {
        setChallenge(
          await api(path + '/challenge', {
            method: 'POST',
            body: JSON.stringify({ target: f.get('target') }),
          }),
        );
        setStatus('Use this source URL and nonce on the destination identity.');
        return;
      }
      const proof = await freshProof(f);
      if (action === 'accept') {
        const d = await api<{ acceptance: string }>(path + '/accept', {
          method: 'POST',
          body: JSON.stringify({ source: f.get('source'), nonce: f.get('nonce'), proof }),
        });
        setAcceptance(d.acceptance);
        setStatus('Return this signed acceptance to the source within ten minutes.');
      } else {
        const d = await api<{ message: string }>(path + '/complete', {
          method: 'POST',
          body: JSON.stringify({
            target: f.get('target'),
            acceptance: f.get('acceptance'),
            confirmHandle: f.get('confirmHandle'),
            proof,
          }),
        });
        setStatus(d.message);
        setChallenge(null);
      }
    } catch (e) {
      setError(message(e));
    }
  }
  return (
    <section className="card stack">
      <h2>Move between approved nodes</h2>
      <p>
        Create the destination identity, export and import your data, and enable public federation
        on both identities. Both operators must approve and pin the other node. Completion archives
        the source and revokes its integrations.
      </p>
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
      <details>
        <summary>1. Start on the source</summary>
        <form className="form-stack" onSubmit={(e) => run(e, 'challenge')}>
          <label>
            Exact destination actor URL
            <input name="target" type="url" required maxLength={2048} />
          </label>
          <button className="button secondary">Create migration challenge</button>
        </form>
        {challenge && (
          <>
            <label>
              Source actor URL
              <input value={challenge.source} readOnly />
            </label>
            <label>
              Destination actor URL
              <input value={challenge.target} readOnly />
            </label>
            <label>
              One-time nonce
              <input value={challenge.nonce} readOnly />
            </label>
          </>
        )}
      </details>
      <details>
        <summary>2. Accept on the destination</summary>
        <form className="form-stack" onSubmit={(e) => run(e, 'accept')}>
          <label>
            Source actor URL
            <input name="source" type="url" required maxLength={2048} />
          </label>
          <label>
            Source challenge nonce
            <input name="nonce" required minLength={20} maxLength={200} />
          </label>
          <Security />
          <button className="button secondary">Sign destination acceptance</button>
        </form>
        {acceptance && (
          <label>
            Signed acceptance
            <textarea value={acceptance} rows={5} readOnly />
          </label>
        )}
      </details>
      <details>
        <summary>3. Complete on the source</summary>
        <form className="form-stack" onSubmit={(e) => run(e, 'complete')}>
          <label>
            Exact destination actor URL
            <input name="target" type="url" required maxLength={2048} />
          </label>
          <label>
            Signed destination acceptance
            <textarea name="acceptance" required maxLength={16000} rows={5} />
          </label>
          <label>
            Type source handle to confirm
            <input name="confirmHandle" required maxLength={30} />
          </label>
          <Security />
          <label className="check">
            <input type="checkbox" required />
            Archive this source and revoke its integrations
          </label>
          <button className="button danger">Complete migration</button>
        </form>
      </details>
    </section>
  );
}
