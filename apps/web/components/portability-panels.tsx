'use client';
import { useLocale } from '../lib/locale-context';
import { useState, useEffect, useCallback, type FormEvent } from 'react';
import { api, message } from '../lib/api';
import { privatePolicy } from '../../../packages/contracts/src/index';
import { freshProof } from './trust-panels';
import type { Identity } from './dashboard';
type Row = Record<string, unknown>;
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
function Notice({ error, status }: { error: string; status: string }) {
  return (
    <>
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
    </>
  );
}
export function RevisionPanel({ identity }: { identity: Identity }) {
  const { formatDate } = useLocale();

  const path = '/identities/' + identity.id,
    [rows, setRows] = useState<Row[]>([]),
    [selected, setSelected] = useState<Row | null>(null),
    [error, setError] = useState(''),
    [status, setStatus] = useState('');
  const reload = useCallback(async () => {
    try {
      setRows(await api<Row[]>(path + '/revisions'));
    } catch (e) {
      setError(message(e));
    }
  }, [path]);
  useEffect(() => {
    void reload();
  }, [reload]);
  async function restore(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError('');
    try {
      const proof = await freshProof(new FormData(e.currentTarget)),
        result = await api<{ message: string }>(path + '/revisions/' + selected!.id + '/restore', {
          method: 'POST',
          body: JSON.stringify({ proof }),
        });
      setStatus(result.message);
      setSelected(null);
      await reload();
    } catch (e) {
      setError(message(e));
    }
  }
  return (
    <section className="card stack">
      <h2>Revisions and comparison</h2>
      <p>
        Review previous text and its difference from the current profile. Restores create private
        owner-entered copies and retain the audit trail.
      </p>
      <Notice error={error} status={status} />
      {rows.map((row) => (
        <div className="list-row" key={String(row.id)}>
          <span>
            Revision {String(row.revision)} · {formatDate(String(row.created_at))}
          </span>
          <button
            className="button secondary"
            onClick={async () => {
              try {
                setSelected(await api<Row>(path + '/revisions/' + row.id));
              } catch (e) {
                setError(message(e));
              }
            }}
          >
            Compare with current
          </button>
        </div>
      ))}
      {selected && (
        <>
          <pre>
            <code>{JSON.stringify(selected.changes, null, 2)}</code>
          </pre>
          <p>{String(selected.restoreBehavior)}</p>
          <form className="form-stack" onSubmit={restore}>
            <Security />
            <button className="button primary">Restore text privately</button>
          </form>
        </>
      )}
    </section>
  );
}
export function ImportPanel({ identity }: { identity: Identity }) {
  const path = '/identities/' + identity.id + '/imports',
    [preview, setPreview] = useState<Row | null>(null),
    [error, setError] = useState(''),
    [status, setStatus] = useState('');
  async function inspect(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError('');
    try {
      const f = new FormData(e.currentTarget),
        url = String(f.get('url') || ''),
        bundle = String(f.get('bundle') || '');
      setPreview(
        await api<Row>(path + '/preview', {
          method: 'POST',
          body: JSON.stringify(url ? { url } : { bundle: JSON.parse(bundle) }),
        }),
      );
    } catch (e) {
      setError(message(e));
    }
  }
  async function commit() {
    setError('');
    try {
      const result = await api<{ message: string }>(path, {
        method: 'POST',
        body: JSON.stringify({ source: preview!.source, claims: preview!.claims }),
      });
      setStatus(result.message);
      setPreview(null);
    } catch (e) {
      setError(message(e));
    }
  }
  return (
    <section className="card stack">
      <h2>Import a profile</h2>
      <p>
        Use a public website&apos;s Person or Organization structured data, or a versioned Orbit
        JSON export. Imported values are unverified and private. Existing authoritative claims
        remain selected. Upload media through Avatar & media.
      </p>
      <Notice error={error} status={status} />
      <form className="form-stack" onSubmit={inspect}>
        <label>
          Public HTTPS website
          <input name="url" type="url" maxLength={2048} />
        </label>
        <label>
          Or paste an Orbit JSON export
          <textarea name="bundle" rows={7} maxLength={2000000} />
        </label>
        <button className="button secondary">Validate and preview import</button>
      </form>
      {preview && (
        <>
          <pre>
            <code>{JSON.stringify(preview.claims, null, 2)}</code>
          </pre>
          <p>{String(preview.message)}</p>
          <button className="button primary" onClick={commit}>
            Import reviewed claims privately
          </button>
        </>
      )}
    </section>
  );
}
export function StatePanel({ identity }: { identity: Identity }) {
  const [error, setError] = useState(''),
    [status, setStatus] = useState('');
  async function change(e: FormEvent<HTMLFormElement>, transfer = false) {
    e.preventDefault();
    setError('');
    try {
      const f = new FormData(e.currentTarget),
        proof = await freshProof(f),
        result = await api<{ message: string }>(
          '/identities/' + identity.id + (transfer ? '/transfer' : '/lifecycle'),
          {
            method: 'POST',
            body: JSON.stringify({
              proof,
              confirmHandle: f.get('confirmation'),
              ...(transfer ? { accountId: f.get('accountId') } : { state: f.get('state') }),
            }),
          },
        );
      setStatus(result.message);
      window.location.reload();
    } catch (e) {
      setError(message(e));
    }
  }
  return (
    <section className="card stack">
      <h2>Identity state and ownership</h2>
      <p>
        Current state: {identity.state}. Locking or archiving revokes application grants.
        Reactivated profiles remain private until you publish again.
      </p>
      <Notice error={error} status={status} />
      <form className="form-stack" onSubmit={(e) => change(e)}>
        <label>
          State
          <select name="state">
            <option value="LOCKED">Lock editing</option>
            <option value="ARCHIVED">Archive privately</option>
            <option value="ACTIVE">Activate privately</option>
          </select>
        </label>
        <label>
          Type the current handle
          <input name="confirmation" required maxLength={30} />
        </label>
        <Security />
        <button className="button secondary">Change identity state</button>
      </form>
      <h3>Transfer ownership</h3>
      <p>
        Invite the recipient to this identity first. They must accept with a verified account. After
        transfer, your membership and existing application grants are revoked.
      </p>
      <form className="form-stack" onSubmit={(e) => change(e, true)}>
        <label>
          Accepted recipient account ID
          <input name="accountId" required maxLength={100} />
        </label>
        <label>
          Type the current handle
          <input name="confirmation" required maxLength={30} />
        </label>
        <Security />
        <button className="button danger">Transfer to accepted member</button>
      </form>
    </section>
  );
}
export function ExtensionPanel({ identity }: { identity: Identity }) {
  const [definitions, setDefinitions] = useState<Row[]>([]),
    [error, setError] = useState(''),
    [status, setStatus] = useState('');
  useEffect(() => {
    api<Row[]>('/schemas')
      .then(setDefinitions)
      .catch((e) => setError(message(e)));
  }, []);
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError('');
    try {
      const f = new FormData(e.currentTarget),
        definition = definitions.find((d) => d.key === f.get('key'))!,
        text = String(f.get('value')),
        value = ['boolean', 'number', 'text_array'].includes(String(definition.type))
          ? JSON.parse(text)
          : text;
      await api('/identities/' + identity.id + '/extensions', {
        method: 'PUT',
        body: JSON.stringify({
          key: f.get('key'),
          value,
          locale: f.get('locale'),
          policy:
            f.get('publication') === 'PUBLIC'
              ? { ...privatePolicy, visibility: 'PUBLIC', api: true, machine: true }
              : privatePolicy,
        }),
      });
      setStatus('Extension value saved with your selected publication policy.');
    } catch (e) {
      setError(message(e));
    }
  }
  return (
    <section className="card stack">
      <h2>Registered schema extensions</h2>
      <Notice error={error} status={status} />
      {definitions.length === 0 ? (
        <p>No extensions registered by this node operator.</p>
      ) : (
        <form className="form-stack" onSubmit={save}>
          <label>
            Schema
            <select name="key">
              {definitions.map((d) => (
                <option value={String(d.key)} key={String(d.key)}>
                  {String(d.title)} · {String(d.type)} · v{String(d.version)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Value
            <textarea name="value" required maxLength={2000} />
          </label>
          <label>
            Language tag
            <input name="locale" defaultValue="en" required maxLength={30} />
          </label>
          <label>
            Publication
            <select name="publication">
              <option value="PRIVATE">Private</option>
              <option value="PUBLIC">Public, including machine-readable profiles</option>
            </select>
          </label>
          <button className="button primary">Save extension</button>
        </form>
      )}
    </section>
  );
}
export function NotificationsPanel() {
  const { formatDate } = useLocale();

  const [rows, setRows] = useState<Row[]>([]),
    [preferences, setPreferences] = useState({ in_app: true, email: false }),
    [error, setError] = useState(''),
    [status, setStatus] = useState('');
  const reload = useCallback(async () => {
    try {
      const [n, p] = await Promise.all([
        api<Row[]>('/notifications'),
        api<typeof preferences>('/notifications/preferences'),
      ]);
      setRows(n);
      setPreferences(p);
    } catch (e) {
      setError(message(e));
    }
  }, []);
  useEffect(() => {
    void reload();
  }, [reload]);
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError('');
    try {
      const f = new FormData(e.currentTarget);
      await api('/notifications/preferences', {
        method: 'PUT',
        body: JSON.stringify({ inApp: f.get('inApp') === 'on', email: f.get('email') === 'on' }),
      });
      await reload();
      setStatus('Notification preferences saved.');
    } catch (e) {
      setError(message(e));
    }
  }
  return (
    <section className="card stack">
      <h2>Notifications</h2>
      <Notice error={error} status={status} />
      <form
        className="form-stack"
        onSubmit={save}
        key={String(preferences.in_app) + String(preferences.email)}
      >
        <label className="check">
          <input type="checkbox" name="inApp" defaultChecked={preferences.in_app} />
          In-app notifications
        </label>
        <label className="check">
          <input type="checkbox" name="email" defaultChecked={preferences.email} />
          Email notifications, limited to one per event type per hour
        </label>
        <button className="button secondary">Save preferences</button>
      </form>
      {rows.map((row) => (
        <div className="list-row" key={String(row.id)}>
          <span>
            {String(row.kind).replaceAll('.', ' ').replaceAll('_', ' ')} ·{' '}
            {formatDate(String(row.created_at))}
          </span>
          {!row.read_at && (
            <button
              className="button secondary"
              onClick={async () => {
                try {
                  await api('/notifications/' + row.id + '/read', { method: 'PUT' });
                  await reload();
                } catch (e) {
                  setError(message(e));
                }
              }}
            >
              Mark read
            </button>
          )}
        </div>
      ))}
      <button
        className="button secondary"
        onClick={async () => {
          try {
            await api('/notifications', { method: 'DELETE' });
            await reload();
          } catch (e) {
            setError(message(e));
          }
        }}
      >
        Clear notifications
      </button>
    </section>
  );
}
