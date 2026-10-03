'use client';
import { useEffect, useState, type FormEvent } from 'react';
import { OperatorTools } from './operator-tools';
interface Report {
  id: string;
  handle: string;
  category: string;
  description: string;
  state: string;
  created_at: string;
}
async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const r = await fetch('/api/v1' + path, {
    ...options,
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json' },
  });
  const b = await r.json();
  if (!r.ok) throw new Error(b.message ?? 'Access unavailable');
  return b as T;
}
export function Moderation() {
  const [reports, setReports] = useState<Report[]>([]),
    [error, setError] = useState(''),
    [authorized, setAuthorized] = useState(false),
    [status, setStatus] = useState('');
  async function load() {
    try {
      await request('/admin/me');
      setAuthorized(true);
      setReports(await request<Report[]>('/admin/reports'));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Access unavailable');
    }
  }
  useEffect(() => {
    void load();
  }, []);
  async function login(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    try {
      await request('/auth/login', {
        method: 'POST',
        body: JSON.stringify({
          email: f.get('email'),
          password: f.get('password'),
          ...(f.get('code') ? { code: f.get('code') } : {}),
        }),
      });
      setError('');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Access unavailable');
    }
  }
  async function review(e: FormEvent<HTMLFormElement>, id: string) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    try {
      await request('/admin/reports/' + id, {
        method: 'POST',
        body: JSON.stringify({
          state: f.get('state'),
          action: f.get('action'),
          reason: f.get('reason'),
        }),
      });
      setStatus('Review recorded.');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Review unavailable');
    }
  }
  return (
    <main id="main" className="developer-content">
      <span className="eyebrow">ORBIT · MODERATION</span>
      <h1>Review with care.</h1>
      <p>Restricted operator access. Every disposition records the moderator and reason.</p>
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      {status && (
        <p className="notice success" role="status">
          {status}
        </p>
      )}
      {!authorized ? (
        <form method="post" className="card stack narrow-form" onSubmit={login}>
          <h2>Moderator sign in</h2>
          <label>
            Email
            <input name="email" type="email" required autoComplete="email" />
          </label>
          <label>
            Password
            <input name="password" type="password" required autoComplete="current-password" />
          </label>
          <label>
            Security code, if enabled
            <input name="code" autoComplete="one-time-code" />
          </label>
          <button className="button primary">Sign in</button>
        </form>
      ) : reports.length === 0 ? (
        <article className="card">
          <h2>No reports to review.</h2>
          <p>The queue is empty.</p>
        </article>
      ) : (
        reports.map((r) => (
          <article className="card stack" key={r.id}>
            <div className="between">
              <h2>@{r.handle}</h2>
              <span className="tag">{r.state}</span>
            </div>
            <strong>{r.category.replaceAll('_', ' ')}</strong>
            <p>{r.description}</p>
            <form method="post" className="stack" onSubmit={(e) => review(e, r.id)}>
              <div className="form-grid">
                <label>
                  Disposition
                  <select name="state">
                    <option value="RESOLVED">Resolved</option>
                    <option value="DISMISSED">Dismissed</option>
                  </select>
                </label>
                <label>
                  Identity action
                  <select name="action">
                    <option value="NONE">No identity action</option>
                    <option value="RESTRICT">Restrict</option>
                    <option value="SUSPEND">Suspend</option>
                    <option value="RESTORE">Restore active state</option>
                  </select>
                </label>
              </div>
              <label>
                Reason
                <textarea name="reason" minLength={20} maxLength={2000} required />
              </label>
              <button className="button secondary">Record review</button>
            </form>
          </article>
        ))
      )}
      {authorized && <OperatorTools />}
    </main>
  );
}
