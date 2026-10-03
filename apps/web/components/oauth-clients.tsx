'use client';
import { useState, type FormEvent } from 'react';
import { api, message } from '../lib/api';
export function OAuthClients({ reload }: { reload: () => Promise<void> }) {
  const [error, setError] = useState(''),
    [result, setResult] = useState<{ client_id: string; client_secret: string | null } | null>(
      null,
    );
  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError('');
    const f = new FormData(e.currentTarget);
    try {
      setResult(
        await api('/oauth/clients', {
          method: 'POST',
          body: JSON.stringify({
            name: f.get('name'),
            purpose: f.get('purpose'),
            mode: f.get('mode'),
            redirectUris: String(f.get('redirects'))
              .split(/\r?\n/)
              .map((s) => s.trim())
              .filter(Boolean),
          }),
        }),
      );
      await reload();
    } catch (e) {
      setError(message(e));
    }
  }
  return (
    <article className="card stack">
      <h2>Register an OAuth client</h2>
      <p className="muted">
        Use authorization codes with S256 PKCE to let people choose their identity and consent to
        fields.
      </p>
      {error && (
        <p role="alert" className="notice error">
          {error}
        </p>
      )}
      {result && (
        <div className="stack secret-card">
          <label>
            Client ID
            <input readOnly value={result.client_id} />
          </label>
          {result.client_secret && (
            <label>
              Client secret (shown once)
              <input readOnly value={result.client_secret} />
            </label>
          )}
          <button className="button secondary" onClick={() => setResult(null)}>
            I have saved the client details
          </button>
        </div>
      )}
      <form method="post" onSubmit={create} className="stack">
        <label>
          OAuth client name
          <input name="name" required maxLength={100} />
        </label>
        <label>
          Access purpose
          <textarea name="purpose" required maxLength={500} />
        </label>
        <label>
          Client type
          <select name="mode">
            <option value="PUBLIC">Public — PKCE, no secret</option>
            <option value="CONFIDENTIAL">Confidential — server with client secret</option>
          </select>
        </label>
        <label>
          Exact redirect URIs, one per line
          <textarea
            name="redirects"
            required
            rows={3}
            maxLength={20000}
            placeholder="https://your-app.example/callback"
          />
        </label>
        <button className="button primary">Create OAuth client</button>
      </form>
      <a href="/developers">OAuth integration guide</a>
    </article>
  );
}
