'use client';
import { useState, useEffect, useCallback, useRef, type FormEvent } from 'react';
import { ArrowRight, Plus, Shield, ExternalLink, Trash2 } from 'lucide-react';
import { api, message } from '../lib/api';
import {
  claimKeys,
  privatePolicy,
  visibilityTypes,
  type Policy,
} from '../../../packages/contracts/src/index';
import type { Identity } from './dashboard';
interface Persona {
  id: string;
  name: string;
  slug: string;
  active: boolean;
}
interface Claim {
  id: string;
  key: string;
  value: unknown;
  persona_id: string | null;
  policy: Policy;
  locale: string;
  source: string;
  verification_state: string;
  selected: boolean;
  revoked_at: string | null;
}
function useRows<T>(path: string) {
  const [rows, setRows] = useState<T[]>([]),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(true);
  const reload = useCallback(async () => {
    try {
      setRows(await api<T[]>(path));
      setError('');
    } catch (e) {
      setError(message(e));
    } finally {
      setLoading(false);
    }
  }, [path]);
  useEffect(() => {
    setLoading(true);
    void reload();
  }, [reload]);
  return { rows, error, setError, reload, loading };
}
function Notice({ error, status }: { error: string; status?: string }) {
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
function Heading({ label, title, copy }: { label: string; title: string; copy: string }) {
  return (
    <div className="page-heading">
      <span className="eyebrow">{label}</span>
      <h1>{title}</h1>
      <p>{copy}</p>
    </div>
  );
}
export function ProfilePanel({
  identity,
  refresh,
}: {
  identity: Identity;
  refresh: () => Promise<void>;
}) {
  const claims = useRows<Claim>('/identities/' + identity.id + '/claims'),
    personas = useRows<Persona>('/identities/' + identity.id + '/personas');
  const [field, setField] = useState<(typeof claimKeys)[number]>('core:display_name'),
    [persona, setPersona] = useState(''),
    [locale, setLocale] = useState(identity.locale),
    [value, setValue] = useState(''),
    [policy, setPolicy] = useState<Policy>(privatePolicy),
    [status, setStatus] = useState(''),
    [busy, setBusy] = useState(false);
  const draftDirty = useRef(false);
  function updatePolicy(next: Policy) {
    draftDirty.current = true;
    setPolicy(next);
  }
  useEffect(() => {
    if (draftDirty.current) return;
    const c = claims.rows.find(
      (c) =>
        c.key === field &&
        (c.persona_id ?? '') === persona &&
        c.locale === locale &&
        c.selected &&
        !c.revoked_at,
    );
    setValue(c ? (typeof c.value === 'string' ? c.value : JSON.stringify(c.value, null, 2)) : '');
    setPolicy(c?.policy ?? privatePolicy);
    setStatus('');
  }, [claims.rows, field, persona, locale]);
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy || claims.loading || personas.loading) return;
    setBusy(true);
    setStatus('');
    claims.setError('');
    try {
      const structured = field === 'core:links' || field === 'developer:languages';
      await api('/identities/' + identity.id + '/claims', {
        method: 'PUT',
        body: JSON.stringify({
          key: field,
          value: structured ? JSON.parse(value) : value,
          personaId: persona || null,
          locale,
          policy,
        }),
      });
      draftDirty.current = false;
      await claims.reload();
      await refresh();
      setStatus('Field saved. Its policy is enforced across profile representations.');
    } catch (e) {
      claims.setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function revoke(claim: Claim) {
    try {
      await api('/identities/' + identity.id + '/claims/' + claim.id, { method: 'DELETE' });
      await claims.reload();
      await refresh();
    } catch (e) {
      claims.setError(message(e));
    }
  }
  return (
    <div className="stack">
      <Heading
        label="PROFILE"
        title="Tell your story."
        copy="Choose a field, pick its audience, and save when you are ready."
      />
      <Notice error={claims.error} status={status} />
      <div className="editor-grid">
        <form
          method="post"
          className="card stack"
          onSubmit={save}
          aria-busy={busy || claims.loading || personas.loading}
        >
          <fieldset
            className="form-controls stack"
            disabled={busy || claims.loading || personas.loading}
          >
            <legend className="sr-only">Profile field details</legend>
            <div className="form-grid">
              <label>
                Persona
                <select
                  value={persona}
                  onChange={(e) => {
                    draftDirty.current = false;
                    setStatus('');
                    setPersona(e.target.value);
                  }}
                >
                  <option value="">Base identity</option>
                  {personas.rows.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Field
                <select
                  value={field}
                  onChange={(e) => {
                    draftDirty.current = false;
                    setStatus('');
                    setField(e.target.value as typeof field);
                  }}
                >
                  {claimKeys.map((k) => (
                    <option value={k} key={k}>
                      {k.split(':')[1]!.replaceAll('_', ' ')}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label>
              Language tag
              <input
                value={locale}
                onChange={(e) => {
                  draftDirty.current = false;
                  setStatus('');
                  setLocale(e.target.value);
                }}
                required
                maxLength={30}
              />
            </label>
            <label>
              {field === 'core:links'
                ? 'Links as JSON: [{"label":"Website","url":"https://example.com"}]'
                : field === 'developer:languages'
                  ? 'Languages as JSON: ["TypeScript","Rust"]'
                  : 'Value'}
              <textarea
                value={value}
                onChange={(e) => {
                  draftDirty.current = true;
                  setValue(e.target.value);
                }}
                rows={field === 'core:bio' ? 7 : 4}
                required={field === 'core:display_name'}
                maxLength={6000}
                dir="auto"
              />
            </label>
            <label>
              Who can see this field?
              <select
                value={policy.visibility}
                onChange={(e) =>
                  updatePolicy({ ...policy, visibility: e.target.value as Policy['visibility'] })
                }
              >
                {visibilityTypes.map((v) => (
                  <option key={v} value={v}>
                    {v.toLowerCase().replaceAll('_', ' ')}
                  </option>
                ))}
              </select>
            </label>
            {policy.visibility === 'SPECIFIC_APPLICATIONS' && (
              <label>
                Allowed application IDs (comma separated)
                <input
                  value={policy.applications.join(',')}
                  onChange={(e) =>
                    updatePolicy({
                      ...policy,
                      applications: e.target.value
                        .split(',')
                        .map((s) => s.trim())
                        .filter(Boolean),
                    })
                  }
                />
              </label>
            )}
            <fieldset className="checkbox-grid">
              <legend>Where it may appear</legend>
              {(['searchable', 'indexable', 'api', 'machine', 'agent'] as const).map((key) => (
                <label className="check" key={key}>
                  <input
                    type="checkbox"
                    checked={policy[key]}
                    onChange={(e) => updatePolicy({ ...policy, [key]: e.target.checked })}
                  />
                  {
                    {
                      searchable: 'Platform search',
                      indexable: 'Search engines',
                      api: 'API access',
                      machine: 'Machine representations',
                      agent: 'Agent access',
                    }[key]
                  }
                </label>
              ))}
            </fieldset>
            <label>
              Disclosure
              <select
                value={policy.transformation}
                onChange={(e) =>
                  updatePolicy({
                    ...policy,
                    transformation: e.target.value as Policy['transformation'],
                  })
                }
              >
                <option value="FULL">Full value</option>
                <option value="GENERALIZED">Generalized value</option>
                <option value="ALIAS">Alias</option>
                <option value="REDACTED">Redacted</option>
                <option value="HIDDEN">Hidden</option>
              </select>
            </label>
            {['GENERALIZED', 'ALIAS'].includes(policy.transformation) && (
              <label>
                Public replacement
                <input
                  value={policy.disclosedValue ?? ''}
                  onChange={(e) => updatePolicy({ ...policy, disclosedValue: e.target.value })}
                  required
                  maxLength={500}
                />
              </label>
            )}
            <button className="button primary" disabled={busy}>
              {busy ? 'Saving…' : 'Save field'} <ArrowRight size={16} />
            </button>
          </fieldset>
        </form>
        <aside className="stack">
          <article className="card">
            <Shield size={22} />
            <h2>Your source of truth.</h2>
            <p className="muted">
              Persona fields override the base identity. A private override keeps that field out of
              the public persona, even if the base value is public.
            </p>
            <p className="muted">
              Saving a field creates a user assertion. It does not establish verification.
            </p>
            {identity.visibility !== 'PRIVATE' && (
              <a
                className="button secondary"
                href={'/u/' + identity.handle}
                target="_blank"
                rel="noopener"
              >
                Preview published profile <ExternalLink size={16} />
              </a>
            )}
          </article>
          <article className="card">
            <h2>Claims and source conflicts</h2>
            {claims.rows.filter((c) => c.selected && !c.revoked_at).length === 0 ? (
              <p className="muted">No active claims yet.</p>
            ) : (
              claims.rows
                .filter((c) => !c.revoked_at)
                .map((c) => (
                  <div className="claim-row" key={c.id}>
                    <div>
                      <strong>{c.key.split(':')[1]!.replaceAll('_', ' ')}</strong>
                      <small>
                        {c.policy.visibility.toLowerCase()} ·{' '}
                        {c.source.toLowerCase().replaceAll('_', ' ')} ·{' '}
                        {c.verification_state.toLowerCase().replaceAll('_', ' ')}
                      </small>
                    </div>
                    {!c.selected && (
                      <button
                        className="button secondary compact"
                        onClick={async () => {
                          try {
                            await api(
                              '/identities/' + identity.id + '/claims/' + c.id + '/select',
                              { method: 'POST' },
                            );
                            await claims.reload();
                            await refresh();
                            setStatus('Authoritative source selected.');
                          } catch (e) {
                            claims.setError(message(e));
                          }
                        }}
                      >
                        Select this source
                      </button>
                    )}
                    <button
                      className="icon-button"
                      onClick={() => revoke(c)}
                      aria-label={'Remove ' + c.key}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))
            )}
          </article>
        </aside>
      </div>
    </div>
  );
}
export function PersonasPanel({ identity }: { identity: Identity }) {
  const data = useRows<Persona>('/identities/' + identity.id + '/personas');
  const [status, setStatus] = useState('');
  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget,
      f = new FormData(form);
    try {
      await api('/identities/' + identity.id + '/personas', {
        method: 'POST',
        body: JSON.stringify({ name: f.get('name'), slug: f.get('slug') }),
      });
      form.reset();
      await data.reload();
      setStatus('Persona created. Add overrides from Profile.');
    } catch (e) {
      data.setError(message(e));
    }
  }
  return (
    <div className="stack">
      <Heading
        label="PERSONAS"
        title="Different contexts. The same you."
        copy="Keep your base identity and override only the fields that need to change."
      />
      <Notice error={data.error} status={status} />
      <div className="persona-grid">
        <article className="card persona-card">
          <span className="tag">Base</span>
          <h2>Your identity</h2>
          <p className="muted">Default values inherited by each persona.</p>
          <code>@{identity.handle}</code>
        </article>
        {data.rows.map((p) => (
          <article className="card persona-card" key={p.id}>
            <span className="tag">{p.active ? 'Active' : 'Inactive'}</span>
            <h2>{p.name}</h2>
            <p className="muted">Overrides live alongside the base profile.</p>
            <code>{p.slug}</code>
          </article>
        ))}
      </div>
      <form method="post" className="card stack narrow-form" onSubmit={create}>
        <h2>Add a persona</h2>
        <label>
          Name
          <input name="name" required maxLength={60} placeholder="Professional" />
        </label>
        <label>
          Slug
          <input name="slug" required pattern="[a-z][a-z0-9_]{2,29}" placeholder="professional" />
        </label>
        <button className="button primary">
          <Plus size={16} /> Create persona
        </button>
      </form>
    </div>
  );
}
export function PrivacyPanel({
  identity,
  refresh,
}: {
  identity: Identity;
  refresh: () => Promise<void>;
}) {
  const [error, setError] = useState(''),
    [status, setStatus] = useState(''),
    [busy, setBusy] = useState(false);
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError('');
    try {
      await api('/identities/' + identity.id + '/settings', {
        method: 'PUT',
        body: JSON.stringify({
          visibility: f.get('visibility'),
          searchable: f.has('searchable'),
          indexable: f.has('indexable'),
          machine: f.has('machine'),
          agent: f.has('agent'),
          contactEnabled: f.has('contactEnabled'),
          theme: f.get('theme'),
          locale: f.get('locale'),
        }),
      });
      await refresh();
      setStatus('Privacy settings saved. Field policies still apply.');
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function rename(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    try {
      await api('/identities/' + identity.id + '/handle', {
        method: 'PUT',
        body: JSON.stringify({ handle: new FormData(e.currentTarget).get('handle') }),
      });
      await refresh();
      setStatus(
        'Handle changed. Your previous handle remains reserved and resolves to this identity.',
      );
    } catch (e) {
      setError(message(e));
    }
  }
  return (
    <div className="stack">
      <Heading
        label="PRIVACY"
        title="Choose where you show up."
        copy="Profile visibility and discoverability are separate. Every field also has its own policy."
      />
      <Notice error={error} status={status} />
      <form method="post" onSubmit={save} className="card stack narrow-form">
        <label>
          Profile visibility
          <select name="visibility" defaultValue={identity.visibility}>
            <option value="PRIVATE">Private — only authorized managers</option>
            <option value="UNLISTED">Unlisted — anyone with the address</option>
            <option value="PUBLIC">Public — eligible for discovery</option>
          </select>
        </label>
        <fieldset className="privacy-options">
          <legend>Discovery and representations</legend>
          {[
            [
              'searchable',
              'Platform search',
              'Allow people to find this public identity in Orbit.',
            ],
            ['indexable', 'Search engines', 'Allow your public profile to be indexed.'],
            [
              'machine',
              'Machine representations',
              'Allow policy-filtered vCard, WebFinger and machine views.',
            ],
            ['agent', 'Agent access', 'Allow the dedicated agent representation.'],
          ].map(([key, title, copy]) => (
            <label className="privacy-option" key={key}>
              <input
                name={key}
                type="checkbox"
                defaultChecked={Boolean(identity[key as keyof Identity])}
              />
              <span>
                <strong>{title}</strong>
                <small>{copy}</small>
              </span>
            </label>
          ))}
        </fieldset>
        <label className="check">
          <input type="checkbox" name="contactEnabled" defaultChecked={identity.contact_enabled} />
          Accept messages through the private contact relay
        </label>
        <div className="form-grid">
          <label>
            Profile theme
            <select name="theme" defaultValue={identity.theme}>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </label>
          <label>
            Locale
            <input name="locale" defaultValue={identity.locale} maxLength={30} />
          </label>
        </div>
        <button className="button primary" disabled={busy}>
          {busy ? 'Saving…' : 'Save privacy settings'}
        </button>
      </form>
      <form method="post" className="card stack narrow-form" onSubmit={rename}>
        <h2>Change your handle</h2>
        <p className="muted">
          Your permanent ID stays the same. Historical handles stay reserved. Renaming has a 30-day
          cooldown.
        </p>
        <label>
          New handle
          <input
            name="handle"
            defaultValue={identity.handle}
            required
            pattern="[a-z][a-z0-9_]{2,29}"
          />
        </label>
        <button className="button secondary">Change handle</button>
      </form>
    </div>
  );
}
import { AvatarTools } from './avatar-tools';
export function AvatarPanel({
  identity,
  refresh,
}: {
  identity: Identity;
  refresh: () => Promise<void>;
}) {
  const data = useRows<{
    id: string;
    status: string;
    alt: string;
    width: number;
    height: number;
    purpose: string;
    public_enabled: boolean;
    created_at: string;
  }>('/identities/' + identity.id + '/media');
  const [status, setStatus] = useState(''),
    [busy, setBusy] = useState(false);
  async function upload(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    data.setError('');
    try {
      const f = new FormData(e.currentTarget),
        file = f.get('image');
      if (!(file instanceof File) || !file.size) throw new Error('Choose an image.');
      const result = await api<{ id: string; url: string; headers: Record<string, string> }>(
        '/identities/' + identity.id + '/media/upload',
        {
          method: 'POST',
          body: JSON.stringify({ bytes: file.size, alt: f.get('alt'), purpose: f.get('purpose') }),
        },
      );
      const response = await fetch(result.url, {
        method: 'PUT',
        body: file,
        headers: result.headers,
      });
      if (!response.ok) throw new Error('The upload could not be completed.');
      await api('/identities/' + identity.id + '/media/' + result.id + '/complete', {
        method: 'POST',
        body: '{}',
      });
      await data.reload();
      setStatus('Uploaded. Refresh the list after processing, then choose Use avatar.');
    } catch (e) {
      data.setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function activate(mediaId: string) {
    try {
      await api('/identities/' + identity.id + '/media/' + mediaId + '/activate', {
        method: 'PUT',
        body: '{}',
      });
      await refresh();
      setStatus('Avatar updated.');
    } catch (e) {
      data.setError(message(e));
    }
  }
  return (
    <div className="stack">
      <Heading
        label="AVATAR & MEDIA"
        title="Make your presence recognizable."
        copy="Your generated avatar is stable. Upload an image when you want something more personal."
      />
      <Notice error={data.error} status={status} />
      <div className="editor-grid">
        <article className="card avatar-current">
          <img
            src={'/avatar/' + identity.id + '?size=256&r=' + identity.revision}
            width={160}
            height={160}
            alt="Current public avatar"
          />
          <h2>@{identity.handle}</h2>
          <p className="muted">Private profiles serve a generated fallback publicly.</p>
          <div className="avatar-styles">
            {['geometric', 'rings', 'initials'].map((style) => (
              <div key={style}>
                <img
                  src={'/avatar/' + identity.id + '?size=64&default=' + style}
                  width={56}
                  height={56}
                  alt={style + ' generated style'}
                />
                <small>{style}</small>
              </div>
            ))}
          </div>
        </article>
        <form method="post" onSubmit={upload} className="card stack">
          <h2>Upload identity media</h2>
          <label>
            Image purpose
            <select name="purpose">
              <option value="AVATAR">Avatar</option>
              <option value="HEADER">Header</option>
              <option value="GALLERY">Gallery</option>
              <option value="PROJECT">Project media</option>
              <option value="BRANDING">Organization branding</option>
            </select>
          </label>
          <label>
            Image
            <input
              type="file"
              name="image"
              accept="image/png,image/jpeg,image/webp,image/avif"
              required
            />
          </label>
          <p className="field-hint">
            PNG, JPEG, WebP or AVIF. Maximum 8 MB. Images are validated, re-encoded and stripped of
            metadata.
          </p>
          <label>
            Alternative text
            <input name="alt" required maxLength={200} placeholder="Describe the avatar" />
          </label>
          <button className="button primary" disabled={busy}>
            {busy ? 'Uploading…' : 'Upload image'}
          </button>
        </form>
      </div>
      <AvatarTools identityId={identity.id} media={data.rows} reload={data.reload} />
      <article className="card">
        <div className="between">
          <h2>Image history</h2>
          <button className="button secondary compact" onClick={() => data.reload()}>
            Refresh status
          </button>
        </div>
        {data.rows.length === 0 ? (
          <p className="muted">Your uploaded images will appear here.</p>
        ) : (
          data.rows.map((m) => (
            <div className="list-row" key={m.id}>
              <div>
                <strong>{m.alt}</strong>
                <small>
                  {m.status.toLowerCase()} {m.width ? '· ' + m.width + ' × ' + m.height : ''}
                </small>
              </div>
              <small>
                Media ID: {m.id} · {m.purpose}
              </small>
              {m.status === 'READY' && m.purpose !== 'AVATAR' && (
                <button
                  className="button secondary compact"
                  onClick={async () => {
                    try {
                      await api('/identities/' + identity.id + '/media/' + m.id + '/publication', {
                        method: 'PUT',
                        body: JSON.stringify({ enabled: !m.public_enabled }),
                      });
                      await data.reload();
                      await refresh();
                      setStatus(
                        m.public_enabled
                          ? 'Media publication revoked.'
                          : 'Media published under identity visibility.',
                      );
                    } catch (e) {
                      data.setError(message(e));
                    }
                  }}
                >
                  {m.public_enabled ? 'Revoke publication' : 'Publish image'}
                </button>
              )}
              {m.status === 'READY' && m.purpose === 'AVATAR' && (
                <button className="button secondary compact" onClick={() => activate(m.id)}>
                  Use avatar
                </button>
              )}
            </div>
          ))
        )}
      </article>
    </div>
  );
}

export {
  ApplicationsPanel,
  OrganizationPanel,
  SecurityPanel,
  ExportPanel,
  DomainsPanel,
  ActivityPanel,
} from './panels-more';
