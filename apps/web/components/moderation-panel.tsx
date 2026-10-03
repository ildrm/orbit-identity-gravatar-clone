'use client';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, message } from '../lib/api';
import type { Identity } from './dashboard';
type Row = Record<string, unknown>;
export function ModerationPanel({ identity }: { identity: Identity }) {
  const path = '/identities/' + identity.id,
    [reports, setReports] = useState<Row[]>([]),
    [appeals, setAppeals] = useState<Row[]>([]),
    [error, setError] = useState(''),
    [status, setStatus] = useState('');
  const reload = useCallback(async () => {
    try {
      const d = await api<{ reports: Row[]; appeals: Row[] }>(path + '/moderation');
      setReports(d.reports);
      setAppeals(d.appeals);
    } catch (e) {
      setError(message(e));
    }
  }, [path]);
  useEffect(() => {
    void reload();
  }, [reload]);
  async function submit(e: FormEvent<HTMLFormElement>, reportId: string) {
    e.preventDefault();
    setError('');
    try {
      const d = await api<{ message: string }>(path + '/appeals', {
        method: 'POST',
        body: JSON.stringify({ reportId, reason: new FormData(e.currentTarget).get('reason') }),
      });
      setStatus(d.message);
      await reload();
    } catch (e) {
      setError(message(e));
    }
  }
  return (
    <section className="card stack">
      <h2>Moderation decisions and appeals</h2>
      <p>You can request an independent review of a resolved moderation decision.</p>
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
      {reports.length === 0 && <p>No moderation decisions for this identity.</p>}
      {reports.map((r) => (
        <article key={String(r.id)} className="stack">
          <h3>{String(r.category).replaceAll('_', ' ')}</h3>
          <p>{String(r.disposition)}</p>
          {r.state === 'RESOLVED' && !appeals.some((a) => a.report_id === r.id) && (
            <form className="form-stack" onSubmit={(e) => submit(e, String(r.id))}>
              <label>
                Reason and evidence for independent review
                <textarea name="reason" required minLength={50} maxLength={3000} />
              </label>
              <button className="button secondary">Submit appeal</button>
            </form>
          )}
        </article>
      ))}
      {appeals.map((a) => (
        <article key={String(a.id)} className="stack">
          <h3>Appeal · {String(a.state)}</h3>
          <p>{String(a.reason)}</p>
          {Boolean(a.disposition) && <p>Review: {String(a.disposition)}</p>}
        </article>
      ))}
    </section>
  );
}
