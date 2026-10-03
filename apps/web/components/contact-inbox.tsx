'use client';
import { useLocale } from '../lib/locale-context';
import { useEffect, useState } from 'react';
import { api, message } from '../lib/api';
import type { Identity } from './dashboard';
interface ContactMessage {
  id: string;
  sender_id: string;
  subject: string;
  body: string;
  state: string;
  created_at: string;
  sender_email: string;
}
export function ContactInbox({ identity }: { identity: Identity }) {
  const { formatDate } = useLocale();

  const [rows, setRows] = useState<ContactMessage[]>([]),
    [error, setError] = useState(''),
    [status, setStatus] = useState(''),
    [loading, setLoading] = useState(true);
  async function reload() {
    try {
      setRows(await api('/identities/' + identity.id + '/contact'));
      setError('');
    } catch (e) {
      setError(message(e));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void reload();
  }, [identity.id]);
  async function block(accountId: string) {
    try {
      await api('/identities/' + identity.id + '/contact/blocks', {
        method: 'POST',
        body: JSON.stringify({ accountId }),
      });
      setStatus('Sender blocked. Future messages will not be delivered.');
    } catch (e) {
      setError(message(e));
    }
  }
  return (
    <section className="stack">
      <div className="page-heading">
        <span className="eyebrow">CONTACT</span>
        <h1>Messages in your orbit.</h1>
        <p>
          Verified senders can reach you when contact is enabled in Privacy. Your email stays
          private.
        </p>
      </div>
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
      <div className="actions">
        <button className="button secondary" onClick={reload}>
          Refresh messages
        </button>
      </div>
      {loading ? (
        <p role="status">Loading messages…</p>
      ) : rows.length === 0 ? (
        <article className="card">
          <h2>No messages yet</h2>
          <p className="muted">
            Contact is {identity.contact_enabled ? 'enabled' : 'disabled'}. Enable it in Privacy to
            accept messages.
          </p>
        </article>
      ) : (
        rows.map((m) => (
          <article className="card stack" key={m.id}>
            <div className="between">
              <h2 dir="auto">{m.subject}</h2>
              <span className="tag">{m.state.toLowerCase()}</span>
            </div>
            <p className="muted small">
              From {m.sender_email} ·{' '}
              <time dateTime={m.created_at}>{formatDate(m.created_at)}</time>
            </p>
            <p dir="auto" style={{ whiteSpace: 'pre-wrap' }}>
              {m.body}
            </p>
            <div className="actions">
              <a
                className="button secondary"
                href={
                  'mailto:' +
                  encodeURIComponent(m.sender_email) +
                  '?subject=' +
                  encodeURIComponent('Re: ' + m.subject)
                }
              >
                Reply by email
              </a>
              <button className="button secondary" onClick={() => block(m.sender_id)}>
                Block sender
              </button>
            </div>
          </article>
        ))
      )}
    </section>
  );
}
