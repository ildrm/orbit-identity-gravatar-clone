'use client';
import { useEffect, useState } from 'react';
import { api, message } from '../lib/api';
import type { PublicProfile } from '../../../packages/contracts/src/index';
export function ProfilePreview({ identityId }: { identityId: string }) {
  const [audience, setAudience] = useState('PUBLIC'),
    [persona, setPersona] = useState(''),
    [consent, setConsent] = useState(''),
    [width, setWidth] = useState('100%'),
    [profile, setProfile] = useState<PublicProfile | null>(null),
    [error, setError] = useState(''),
    [personas, setPersonas] = useState<{ id: string; name: string; slug: string }[]>([]),
    [grants, setGrants] = useState<{ id: string; name: string; slug: string | null }[]>([]);
  useEffect(() => {
    void Promise.all([
      api<typeof personas>('/identities/' + identityId + '/personas'),
      api<typeof grants>('/identities/' + identityId + '/preview-grants'),
    ])
      .then(([p, g]) => {
        setPersonas(p);
        setGrants(g);
      })
      .catch((e) => setError(message(e)));
  }, [identityId]);
  async function preview() {
    setError('');
    setProfile(null);
    try {
      const q = new URLSearchParams({
        audience,
        ...(persona ? { persona } : {}),
        ...(consent ? { consent } : {}),
      });
      setProfile(await api('/identities/' + identityId + '/preview?' + q));
    } catch (e) {
      setError(message(e));
    }
  }
  return (
    <article className="card stack">
      <h2>Visibility preview</h2>
      <p>
        Preview saved content using the same disclosure rules as each audience. Application previews
        use a current grant and its selected persona.
      </p>
      <div className="form-grid">
        <label>
          Preview audience
          <select
            value={audience}
            onChange={(e) => {
              setAudience(e.target.value);
              setProfile(null);
            }}
          >
            <option value="PUBLIC">Public visitor</option>
            <option value="SEARCH">Search engine</option>
            <option value="APPLICATION">Specific application</option>
            <option value="OWNER">Management view</option>
          </select>
        </label>
        {audience === 'APPLICATION' ? (
          <label>
            Application grant
            <select value={consent} onChange={(e) => setConsent(e.target.value)}>
              <option value="">Choose an application</option>
              {grants.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                  {g.slug ? ' · ' + g.slug : ''}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <label>
            Preview persona
            <select value={persona} onChange={(e) => setPersona(e.target.value)}>
              <option value="">Default profile</option>
              {personas.map((p) => (
                <option key={p.id} value={p.slug}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          Preview width
          <select value={width} onChange={(e) => setWidth(e.target.value)}>
            <option value="100%">Available width</option>
            <option value="390px">Phone</option>
            <option value="768px">Tablet</option>
          </select>
        </label>
      </div>
      <button
        type="button"
        className="button secondary"
        onClick={preview}
        disabled={audience === 'APPLICATION' && !consent}
      >
        Refresh preview
      </button>
      {error && (
        <p role="status" className="notice">
          This audience cannot view the saved profile. {error}
        </p>
      )}
      {profile && (
        <section
          aria-label="Saved profile preview"
          className="stack"
          style={{ width, maxWidth: '100%', overflowWrap: 'anywhere' }}
        >
          <h3>{profile.displayName}</h3>
          <p>@{profile.handle}</p>
          {profile.claims.map((c) => (
            <div key={c.key}>
              <strong>{c.key.replace(/^[^:]+:/, '').replaceAll('_', ' ')}</strong>
              <p dir="auto">{typeof c.value === 'string' ? c.value : JSON.stringify(c.value)}</p>
            </div>
          ))}
          {profile.blocks?.map((b) => (
            <section key={b.id} lang={b.locale}>
              <h4>{b.title}</h4>
              <p dir="auto">{b.configuration.text}</p>
              {b.configuration.items.map((item, n) => (
                <p key={n}>
                  <a href={item.url} rel="noopener noreferrer">
                    {item.label}
                  </a>
                </p>
              ))}
            </section>
          ))}
        </section>
      )}
    </article>
  );
}
