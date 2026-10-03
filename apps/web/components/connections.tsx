'use client';
import { useLocale } from '../lib/locale-context';
import { useEffect, useState } from 'react';
import { api, message } from '../lib/api';
import type { Identity } from './dashboard';
interface Connection {
  id: string;
  provider: string;
  username: string;
  mode: string;
  last_synced_at: string | null;
  revoked_at: string | null;
}
export function ConnectionsPanel({ identity }: { identity: Identity }) {
  const { formatDate } = useLocale();

  const [enabled, setEnabled] = useState(false),
    [rows, setRows] = useState<Connection[]>([]),
    [error, setError] = useState(''),
    [status, setStatus] = useState(''),
    [fields, setFields] = useState(['developer:github']);
  async function load() {
    try {
      const features = await api<{ github: boolean }>('/features');
      setEnabled(features.github);
      setRows(await api<Connection[]>('/identities/' + identity.id + '/connections'));
    } catch (e) {
      setError(message(e));
    }
  }
  useEffect(() => {
    void load();
  }, [identity.id]);
  async function begin() {
    try {
      const result = await api<{ url: string }>(
        '/identities/' + identity.id + '/connections/github/start',
        { method: 'POST', body: JSON.stringify({ fields, mode: 'ONE_TIME' }) },
      );
      window.location.assign(result.url);
    } catch (e) {
      setError(message(e));
    }
  }
  async function sync(id: string) {
    try {
      const result = await api<{ message: string }>(
        '/identities/' + identity.id + '/connections/' + id + '/sync',
        { method: 'POST', body: '{}' },
      );
      setStatus(result.message);
      await load();
    } catch (e) {
      setError(message(e));
    }
  }
  async function remove(id: string) {
    try {
      const result = await api<{ message: string }>(
        '/identities/' + identity.id + '/connections/' + id,
        { method: 'DELETE' },
      );
      setStatus(result.message);
      await load();
    } catch (e) {
      setError(message(e));
    }
  }
  return (
    <div className="stack">
      <div className="page-heading">
        <span className="eyebrow">CONNECTIONS</span>
        <h1>Bring your sources together.</h1>
        <p>
          Connect GitHub with read-only profile access. Imports start private and preserve your
          manual fields.
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
      <article className="card stack">
        <h2>GitHub account proof</h2>
        {enabled ? (
          <>
            <fieldset className="checkbox-grid">
              <legend>Import selected fields</legend>
              {['developer:github', 'core:bio', 'core:display_name'].map((key) => (
                <label className="check" key={key}>
                  <input
                    type="checkbox"
                    checked={fields.includes(key)}
                    onChange={(e) =>
                      setFields(
                        e.target.checked ? [...fields, key] : fields.filter((v) => v !== key),
                      )
                    }
                  />
                  {key}
                </label>
              ))}
            </fieldset>
            <button className="button primary" disabled={!fields.length} onClick={begin}>
              Connect GitHub
            </button>
          </>
        ) : (
          <p className="muted">
            GitHub connection is disabled on this instance. The operator can enable it with an OAuth
            application.
          </p>
        )}
      </article>
      <article className="card">
        <h2>Your connections</h2>
        {rows.length === 0 ? (
          <p className="muted">No accounts connected.</p>
        ) : (
          rows.map((c) => (
            <div className="list-row" key={c.id}>
              <div>
                <strong>
                  {c.provider} · @{c.username}
                </strong>
                <small>
                  {c.revoked_at ? 'Disconnected' : c.mode.toLowerCase().replaceAll('_', ' ')} · Last
                  import {c.last_synced_at ? formatDate(c.last_synced_at) : 'Never'}
                </small>
              </div>
              {!c.revoked_at && (
                <div className="actions">
                  <button className="button secondary compact" onClick={() => sync(c.id)}>
                    Import again
                  </button>
                  <button className="button secondary compact" onClick={() => remove(c.id)}>
                    Disconnect
                  </button>
                </div>
              )}
            </div>
          ))
        )}
      </article>
    </div>
  );
}
