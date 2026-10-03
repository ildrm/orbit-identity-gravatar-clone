'use client';
import { localeDirection } from '../lib/locale';
import { useEffect } from 'react';
import type { PublicProfile } from '../../../packages/contracts/src/index';
function optOut() {
  return (
    navigator.doNotTrack === '1' ||
    (navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl === true
  );
}
export function PublicBlocks({ profile }: { profile: PublicProfile }) {
  function record(kind: string) {
    if (optOut()) return;
    void fetch('/api/v1/profiles/' + profile.id + '/activity', {
      method: 'POST',
      credentials: 'omit',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind, ...(profile.persona ? { persona: profile.persona } : {}) }),
      keepalive: true,
    }).catch(() => {});
  }
  useEffect(() => {
    record('profile_view');
    if (profile.persona) record('persona_view');
  }, [profile.id, profile.persona]);
  return (
    <div className="stack">
      {profile.blocks?.map((b) => (
        <section
          className="profile-block stack"
          key={b.id}
          lang={b.locale}
          dir={localeDirection(b.locale)}
        >
          <h2>{b.title}</h2>
          {b.configuration.text && (
            <p className="profile-bio" dir="auto">
              {b.configuration.text}
            </p>
          )}
          {b.configuration.mediaIds?.map((mediaId, n) => (
            <img
              key={mediaId}
              src={'/assets/' + mediaId + '/512.webp'}
              alt={b.title + ' — image ' + (n + 1)}
              width={512}
              height={512}
              loading="lazy"
            />
          ))}
          {b.configuration.url && (
            <a
              href={b.configuration.url}
              rel="noopener noreferrer"
              onClick={() => record('block_interaction')}
            >
              {b.title}
            </a>
          )}
          {b.configuration.items.length > 0 && (
            <ul className="stack">
              {b.configuration.items.map((item, n) => (
                <li key={n}>
                  <a href={item.url} rel="noopener noreferrer" onClick={() => record('link_click')}>
                    {item.label}
                  </a>
                  {item.description && <p dir="auto">{item.description}</p>}
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}
