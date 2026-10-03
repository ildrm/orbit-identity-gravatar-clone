'use client';
import { useState, type FormEvent } from 'react';
import { api, message } from '../lib/api';
export function ContactForm({
  identityId,
  nativeContactUrl,
}: {
  identityId: string;
  nativeContactUrl?: string;
}) {
  const [error, setError] = useState(''),
    [status, setStatus] = useState(''),
    [busy, setBusy] = useState(false);
  if (nativeContactUrl)
    return (
      <a className="button secondary" href={nativeContactUrl}>
        Open secure contact on Orbit
      </a>
    );
  async function send(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const f = new FormData(e.currentTarget);
    try {
      const d = await api<{ message: string }>('/contact/' + identityId, {
        method: 'POST',
        body: JSON.stringify({
          subject: f.get('subject'),
          body: f.get('body'),
          shareEmail: f.has('shareEmail'),
        }),
      });
      setStatus(d.message);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="profile-provenance">
      <summary>Contact this identity</summary>
      <form method="post" className="stack" onSubmit={send}>
        <p>Sign in before sending. The recipient address stays private.</p>
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
        <label>
          Subject
          <input name="subject" minLength={3} maxLength={150} required />
        </label>
        <label>
          Message
          <textarea name="body" minLength={20} maxLength={3000} required rows={5} />
        </label>
        <label className="check">
          <input name="shareEmail" type="checkbox" required />
          Share my verified email with the recipient so they can reply.
        </label>
        <button className="button primary" disabled={busy}>
          {busy ? 'Sending…' : 'Send message'}
        </button>
      </form>
    </details>
  );
}
