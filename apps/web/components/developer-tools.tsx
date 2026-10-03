'use client';
import { useState, type FormEvent } from 'react';
import { api, message } from '../lib/api';
export function DeveloperTools() {
  const [result, setResult] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  async function explore(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const f = new FormData(e.currentTarget),
        p = await api('/profiles/' + encodeURIComponent(String(f.get('identifier'))));
      setResult(JSON.stringify(p, null, 2));
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function manage(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const f = new FormData(e.currentTarget),
        base = '/applications/' + String(f.get('application')),
        action = String(f.get('action')),
        hook = String(f.get('hook') ?? ''),
        delivery = String(f.get('delivery') ?? '');
      const path =
        action === 'usage' || action === 'logs' || action === 'deliveries'
          ? base + '/' + action
          : action === 'replay'
            ? base + '/deliveries/' + delivery + '/replay'
            : base +
              '/webhooks/' +
              hook +
              '/' +
              (action === 'enable' || action === 'disable' ? 'settings' : action);
      const data = await api(path, {
        method: ['usage', 'logs', 'deliveries'].includes(action)
          ? 'GET'
          : ['enable', 'disable'].includes(action)
            ? 'PUT'
            : 'POST',
        ...(['enable', 'disable'].includes(action)
          ? { body: JSON.stringify({ enabled: action === 'enable' }) }
          : {}),
      });
      setResult(JSON.stringify(data, null, 2));
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <article className="card stack">
      <h2>API explorer and application diagnostics</h2>
      <p>
        Public lookups work immediately. Application diagnostics require your signed-in application
        owner account. Request logs contain operation and correlation IDs; profile contents and
        credentials are excluded.
      </p>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <form method="post" className="stack" onSubmit={explore}>
        <label>
          Public handle or opaque identity ID
          <input name="identifier" required maxLength={100} />
        </label>
        <button className="button secondary" disabled={busy}>
          Read current public profile
        </button>
      </form>
      <form method="post" className="stack" onSubmit={manage}>
        <label>
          Application ID
          <input name="application" required pattern="app_[a-f0-9]{32}" />
        </label>
        <label>
          Action
          <select name="action">
            {[
              ['usage', 'Usage summary'],
              ['logs', 'Recent API access'],
              ['deliveries', 'Webhook deliveries'],
              ['test', 'Send signed webhook test'],
              ['rotate', 'Rotate webhook secret'],
              ['enable', 'Enable webhook'],
              ['disable', 'Disable webhook'],
              ['replay', 'Replay a completed or failed delivery'],
            ].map(([v, label]) => (
              <option value={v} key={v}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Webhook ID (for webhook actions)
          <input name="hook" maxLength={100} />
        </label>
        <label>
          Job ID (for replay)
          <input name="delivery" maxLength={100} />
        </label>
        <button className="button secondary" disabled={busy}>
          Run selected action
        </button>
      </form>
      {result && (
        <pre aria-label="API response" tabIndex={0}>
          <code>{result}</code>
        </pre>
      )}
    </article>
  );
}
