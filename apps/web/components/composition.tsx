'use client';
import { useLocale } from '../lib/locale-context';
import { useEffect, useState, type FormEvent } from 'react';
import { ProfilePreview } from './profile-preview';
import { api, message } from '../lib/api';
import { blockKinds } from '../../../packages/contracts/src/blocks';
import { publicPolicy, privatePolicy } from '../../../packages/contracts/src/index';
import type { Identity } from './dashboard';
interface Block {
  id: string;
  kind: string;
  title: string;
  position: number;
  enabled: boolean;
  locale: string;
  persona_id: string | null;
  configuration: {
    text: string;
    url?: string;
    items: { label: string; url: string; description?: string }[];
    mediaIds?: string[];
  };
  policy: typeof privatePolicy;
}
export function CompositionPanel({ identity }: { identity: Identity }) {
  const [rows, setRows] = useState<Block[]>([]),
    [error, setError] = useState(''),
    [status, setStatus] = useState(''),
    [editing, setEditing] = useState<Block | null>(null),
    [saving, setSaving] = useState(false),
    [personas, setPersonas] = useState<{ id: string; name: string }[]>([]),
    [media, setMedia] = useState<{ id: string; alt: string; purpose: string; status: string }[]>(
      [],
    ),
    [items, setItems] = useState<Block['configuration']['items']>([]);
  async function reload() {
    const [nextRows, nextPersonas, nextMedia] = await Promise.all([
      api<Block[]>('/identities/' + identity.id + '/blocks'),
      api<typeof personas>('/identities/' + identity.id + '/personas'),
      api<typeof media>('/identities/' + identity.id + '/media'),
    ]);
    setRows(nextRows);
    setPersonas(nextPersonas);
    setMedia(nextMedia);
  }
  useEffect(() => {
    void reload().catch((e) => setError(message(e)));
  }, [identity.id]);
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    setError('');
    setStatus('');
    const form = e.currentTarget,
      f = new FormData(form);
    try {
      const labels = f.getAll('entryLabel'),
        urls = f.getAll('entryUrl'),
        descriptions = f.getAll('entryDescription'),
        items = labels.map((label, n) => ({
          label: String(label),
          url: String(urls[n]),
          ...(descriptions[n] ? { description: String(descriptions[n]) } : {}),
        })),
        mediaIds = f.getAll('mediaIds').map(String);
      await api('/identities/' + identity.id + '/blocks' + (editing ? '/' + editing.id : ''), {
        method: editing ? 'PUT' : 'POST',
        body: JSON.stringify({
          kind: f.get('kind'),
          title: f.get('title'),
          position: Number(f.get('position')),
          enabled: f.get('enabled') === 'on',
          locale: f.get('locale'),
          personaId: f.get('persona') || null,
          policy: f.get('public') === 'on' ? publicPolicy : privatePolicy,
          configuration: {
            mediaIds,
            text: f.get('text'),
            ...(f.get('url') ? { url: f.get('url') } : {}),
            items,
          },
        }),
      });
      form.reset();
      setEditing(null);
      setItems([]);
      await reload();
      setStatus('Profile composition saved.');
    } catch (e) {
      setError(message(e));
    } finally {
      setSaving(false);
    }
  }
  async function move(source: string, target: number) {
    try {
      const ids = rows.map((b) => b.id),
        start = ids.indexOf(source);
      if (start < 0 || target < 0 || target >= ids.length) return;
      ids.splice(start, 1);
      ids.splice(target, 0, source);
      await api('/identities/' + identity.id + '/block-order', {
        method: 'POST',
        body: JSON.stringify({ ids }),
      });
      await reload();
      setStatus('Block order saved.');
    } catch (e) {
      setError(message(e));
      await reload();
    }
  }
  async function remove(blockId: string) {
    try {
      await api('/identities/' + identity.id + '/blocks/' + blockId, { method: 'DELETE' });
      await reload();
      setStatus('Block removed.');
    } catch (e) {
      setError(message(e));
    }
  }
  return (
    <div className="stack">
      <div className="page-heading">
        <span className="eyebrow">PROFILE COMPOSITION</span>
        <h1>Build your profile in blocks.</h1>
        <p>Order content, choose its persona and language, and enable it when ready.</p>
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
      <article className="card">
        <h2>Your blocks</h2>
        <p className="field-hint">Drag a block to reorder it, or use Move up and Move down.</p>
        {rows.map((b, n) => (
          <div
            className="list-row"
            key={b.id}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              if (!saving) void move(e.dataTransfer.getData('text/plain'), n);
            }}
          >
            <div>
              <strong>
                {b.position}. {b.title}
              </strong>
              <small>
                {b.kind} · {b.enabled ? 'Enabled' : 'Disabled'} ·{' '}
                {b.policy.visibility.toLowerCase()} · {b.locale}
              </small>
            </div>
            <div className="actions">
              <button
                type="button"
                className="button secondary"
                draggable={!saving}
                disabled={saving}
                onDragStart={(e) => {
                  e.dataTransfer.setData('text/plain', b.id);
                  e.dataTransfer.effectAllowed = 'move';
                }}
                aria-label={'Drag ' + b.title + ' to reorder'}
              >
                Drag
              </button>
              <button
                type="button"
                className="button secondary"
                disabled={saving || n === 0}
                onClick={() => move(b.id, n - 1)}
              >
                Move up
              </button>
              <button
                type="button"
                className="button secondary"
                disabled={saving || n === rows.length - 1}
                onClick={() => move(b.id, n + 1)}
              >
                Move down
              </button>
              <button
                className="button secondary"
                disabled={saving}
                onClick={() => {
                  setEditing(b);
                  setItems(b.configuration.items);
                }}
              >
                Edit block
              </button>
              <button className="button secondary" disabled={saving} onClick={() => remove(b.id)}>
                Remove block
              </button>
            </div>
          </div>
        ))}
      </article>
      <form
        method="post"
        onSubmit={save}
        className="card stack narrow-form"
        key={editing?.id ?? 'new'}
        aria-busy={saving}
      >
        <h2>{editing ? 'Edit block' : 'Add a block'}</h2>
        <fieldset disabled={saving} className="form-controls stack">
          <legend className="sr-only">Block details</legend>
          <label>
            Block type
            <select name="kind" defaultValue={editing?.kind ?? 'biography'}>
              {blockKinds.map((k) => (
                <option key={k} value={k}>
                  {k.replaceAll('_', ' ')}
                </option>
              ))}
            </select>
          </label>
          <label>
            Block title
            <input name="title" defaultValue={editing?.title} required maxLength={160} />
          </label>
          <label>
            Order
            <input
              name="position"
              type="number"
              defaultValue={editing?.position ?? rows.length}
              min={0}
              max={1000}
              required
            />
          </label>
          <label>
            Content
            <textarea
              name="text"
              defaultValue={editing?.configuration.text}
              maxLength={10000}
              rows={5}
            />
          </label>
          <label>
            Destination URL
            <input
              name="url"
              type="url"
              defaultValue={editing?.configuration.url}
              placeholder="https://…"
            />
          </label>
          <fieldset className="stack">
            <legend>Links and entries</legend>
            {items.map((item, n) => (
              <div className="stack" key={n}>
                <label>
                  Entry {n + 1} label
                  <input
                    name="entryLabel"
                    value={item.label}
                    maxLength={160}
                    required
                    onChange={(e) =>
                      setItems(items.map((v, k) => (k === n ? { ...v, label: e.target.value } : v)))
                    }
                  />
                </label>
                <label>
                  Entry {n + 1} URL
                  <input
                    name="entryUrl"
                    value={item.url}
                    type="url"
                    required
                    maxLength={2048}
                    onChange={(e) =>
                      setItems(items.map((v, k) => (k === n ? { ...v, url: e.target.value } : v)))
                    }
                  />
                </label>
                <label>
                  Entry {n + 1} description
                  <input
                    name="entryDescription"
                    value={item.description ?? ''}
                    maxLength={1000}
                    onChange={(e) =>
                      setItems(
                        items.map((v, k) => (k === n ? { ...v, description: e.target.value } : v)),
                      )
                    }
                  />
                </label>
                <button
                  type="button"
                  className="button secondary"
                  onClick={() => setItems(items.filter((_, k) => k !== n))}
                >
                  Remove entry {n + 1}
                </button>
              </div>
            ))}
            <button
              type="button"
              className="button secondary"
              disabled={items.length >= 30}
              onClick={() => setItems([...items, { label: '', url: '' }])}
            >
              Add entry
            </button>
          </fieldset>
          <fieldset className="stack">
            <legend>Images</legend>
            {media
              .filter((m) => m.status === 'READY')
              .map((m) => (
                <label className="check" key={m.id}>
                  <input
                    type="checkbox"
                    name="mediaIds"
                    value={m.id}
                    defaultChecked={editing?.configuration.mediaIds?.includes(m.id) ?? false}
                  />
                  {m.alt || 'Untitled image'} · {m.purpose.toLowerCase()}
                </label>
              ))}
            <p className="field-hint">
              Publish selected images in Avatar & media before using them in a public gallery or
              project block.
            </p>
          </fieldset>
          <label>
            Persona
            <select name="persona" defaultValue={editing?.persona_id ?? ''}>
              <option value="">Default profile</option>
              {personas.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Language tag
            <input name="locale" defaultValue={editing?.locale ?? 'en'} required maxLength={30} />
          </label>
          <label className="check">
            <input name="enabled" type="checkbox" defaultChecked={editing?.enabled ?? false} />
            Enable this block
          </label>
          <label className="check">
            <input
              name="public"
              type="checkbox"
              defaultChecked={editing?.policy.visibility === 'PUBLIC'}
            />
            Publish this block
          </label>
          <p className="muted small">
            Content is rendered as text and validated links. Scripts, HTML execution, and automatic
            third-party embeds are excluded.
          </p>
          <div className="actions">
            <button className="button primary">Save block</button>
            {editing && (
              <button
                type="button"
                className="button secondary"
                onClick={() => {
                  setEditing(null);
                  setItems([]);
                }}
              >
                Cancel editing
              </button>
            )}
          </div>
        </fieldset>
      </form>
      <ProfilePreview identityId={identity.id} />
    </div>
  );
}
export function AnalyticsPanel({ identity }: { identity: Identity }) {
  const { formatDate } = useLocale();

  const [data, setData] = useState<{
      enabled: boolean;
      retentionDays: number;
      days: { day: string; kind: string; count: string }[];
    } | null>(null),
    [error, setError] = useState('');
  async function reload() {
    setData(await api('/identities/' + identity.id + '/analytics'));
  }
  useEffect(() => {
    void reload().catch((e) => setError(message(e)));
  }, [identity.id]);
  async function toggle() {
    try {
      await api('/identities/' + identity.id + '/analytics/settings', {
        method: 'PUT',
        body: JSON.stringify({ enabled: !data?.enabled }),
      });
      await reload();
    } catch (e) {
      setError(message(e));
    }
  }
  return (
    <div className="stack">
      <div className="page-heading">
        <span className="eyebrow">AGGREGATE ANALYTICS</span>
        <h1>Understand activity, respect visitors.</h1>
        <p>
          Daily event totals. No visitor identifiers, fingerprints, geographic enrichment, or
          cross-site correlation.
        </p>
      </div>
      {error && (
        <p role="alert" className="notice error">
          {error}
        </p>
      )}
      <article className="card stack">
        <h2>Analytics are {data?.enabled ? 'enabled' : 'disabled'}</h2>
        <p>
          Counts expire after 90 days. Disabling analytics removes existing counts. Do Not Track and
          Global Privacy Control requests are respected.
        </p>
        {identity.role === 'OWNER' && (
          <button className="button secondary" onClick={toggle}>
            {data?.enabled ? 'Disable and clear analytics' : 'Enable aggregate analytics'}
          </button>
        )}
        <button
          className="button secondary"
          onClick={() => reload().catch((e) => setError(message(e)))}
        >
          Refresh counts
        </button>
        {data?.days.length ? (
          <table>
            <caption>Daily activity</caption>
            <thead>
              <tr>
                <th scope="col">Day</th>
                <th scope="col">Event</th>
                <th scope="col">Count</th>
              </tr>
            </thead>
            <tbody>
              {data.days.map((d) => (
                <tr key={d.day + d.kind}>
                  <td>{formatDate(d.day, true)}</td>
                  <td>{d.kind.replaceAll('_', ' ')}</td>
                  <td>{d.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="muted">No aggregate activity recorded.</p>
        )}
      </article>
    </div>
  );
}
