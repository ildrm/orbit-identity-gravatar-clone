'use client';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, message } from '../lib/api';
import {
  privatePolicy,
  relationshipSchema,
  type PublicProfile,
} from '../../../packages/contracts/src/index';
import type { Identity } from './dashboard';
interface Relationship {
  id: string;
  source_id: string;
  target_id: string;
  source_handle: string;
  target_handle: string;
  type: string;
  verification_state: string;
  expires_at: string | null;
}
export function RelationshipsPanel({ identity }: { identity: Identity }) {
  const [rows, setRows] = useState<Relationship[]>([]),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [status, setStatus] = useState('');
  const load = useCallback(async () => {
    try {
      setRows(await api<Relationship[]>('/identities/' + identity.id + '/relationships'));
    } catch (e) {
      setError(message(e));
    } finally {
      setLoading(false);
    }
  }, [identity.id]);
  useEffect(() => {
    void load();
  }, [load]);
  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget,
      values = new FormData(form);
    setBusy(true);
    setError('');
    setStatus('');
    try {
      const identifier = String(values.get('target')).trim().replace(/^@/, '');
      const target = await api<PublicProfile>('/profiles/' + encodeURIComponent(identifier));
      await api('/identities/' + identity.id + '/relationships', {
        method: 'POST',
        body: JSON.stringify({
          targetId: target.id,
          type: values.get('type'),
          policy: privatePolicy,
        }),
      });
      form.reset();
      await load();
      setStatus(
        'Relationship requested. The other identity must confirm it before it grants an audience.',
      );
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function action(row: Relationship, kind: 'confirm' | 'revoke') {
    setBusy(true);
    setError('');
    setStatus('');
    try {
      await api('/relationships/' + row.id + (kind === 'confirm' ? '/confirm' : ''), {
        method: kind === 'confirm' ? 'POST' : 'DELETE',
        ...(kind === 'confirm' ? { body: '{}' } : {}),
      });
      await load();
      setStatus(
        kind === 'confirm'
          ? 'Relationship confirmed.'
          : 'Relationship revoked. Its audience access has ended.',
      );
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  const canCreate = ['OWNER', 'ADMIN', 'EDITOR', 'PROFILE_MANAGER'].includes(identity.role);
  const canConfirm = ['OWNER', 'ADMIN', 'HR_MANAGER'].includes(identity.role);
  const canRevoke = ['OWNER', 'ADMIN'].includes(identity.role);
  return (
    <section>
      <div className="page-heading">
        <span className="eyebrow">RELATIONSHIPS</span>
        <h1>Confirm your connections</h1>
        <p>
          Mutual relationships grant the Connections audience to the owner of the other identity.
          Confirmed employment or membership grants the Organization audience to members of that
          organization.
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
      {canCreate && (
        <form className="card form-stack" method="post" onSubmit={create}>
          <h2>Request a relationship</h2>
          <label>
            Target public handle or identity ID
            <input name="target" required maxLength={100} placeholder="@handle" />
          </label>
          <label>
            Relationship
            <select name="type">
              {relationshipSchema.shape.type.options.map((type) => (
                <option key={type} value={type}>
                  {type.replaceAll('_', ' ')}
                </option>
              ))}
            </select>
          </label>
          <p className="muted small">The relationship record stays private to its participants.</p>
          <button className="button primary" disabled={busy}>
            {busy ? 'Saving…' : 'Send request'}
          </button>
        </form>
      )}
      <div className="card">
        <h2>Incoming and outgoing relationships</h2>
        {loading ? (
          <p role="status">Loading relationships…</p>
        ) : rows.length === 0 ? (
          <p className="muted">No active relationships yet.</p>
        ) : (
          <div className="stack">
            {rows.map((row) => (
              <article className="list-row" key={row.id}>
                <div>
                  <strong>
                    @{row.source_handle} → @{row.target_handle}
                  </strong>
                  <p className="small muted">
                    {row.type.replaceAll('_', ' ')} ·{' '}
                    {row.verification_state.replaceAll('_', ' ').toLowerCase()}
                  </p>
                </div>
                <div className="actions">
                  {canConfirm &&
                    row.target_id === identity.id &&
                    row.verification_state === 'UNILATERAL' && (
                      <button
                        className="button secondary compact"
                        disabled={busy}
                        onClick={() => void action(row, 'confirm')}
                      >
                        Confirm
                      </button>
                    )}
                  {canRevoke && (
                    <button
                      className="button secondary compact"
                      disabled={busy}
                      onClick={() => void action(row, 'revoke')}
                    >
                      Revoke
                    </button>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
