import { localeDirection } from '../../../lib/locale';
import { PublicBlocks } from '../../../components/profile-composition';
import { ContactForm } from '../../../components/contact-form';
import type { Metadata } from 'next';
import { cookies, headers } from 'next/headers';
import { notFound, permanentRedirect } from 'next/navigation';
import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
import { Brand } from '../../../components/brand';
import { publicProfile } from '../../../lib/server';
type Props = { params: Promise<{ handle: string }>; searchParams: Promise<{ persona?: string }> };
export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { handle } = await params,
    { persona } = await searchParams,
    p = await publicProfile(handle, persona),
    sessionPresent = (await cookies()).has('identity_session');
  if (!p)
    return {
      title: 'Profile unavailable',
      robots: { index: false, follow: false },
      openGraph: { images: [] },
      twitter: { images: [] },
    };
  return {
    title: p.displayName,
    description: 'A public identity on Orbit.',
    alternates: {
      canonical:
        p.canonicalUrl ??
        '/u/' + p.handle + (persona ? '?persona=' + encodeURIComponent(persona) : ''),
    },
    robots: { index: p.indexable && !sessionPresent, follow: p.indexable && !sessionPresent },
    openGraph: { title: p.displayName, description: 'A public identity on Orbit.', images: [] },
    twitter: { title: p.displayName, description: 'A public identity on Orbit.', images: [] },
  };
}
export default async function ProfilePage({ params, searchParams }: Props) {
  const { handle } = await params,
    { persona } = await searchParams,
    p = await publicProfile(handle, persona, true);
  if (!p) notFound();
  if (p.canonicalHandle)
    permanentRedirect(
      '/u/' + p.handle + (persona ? '?persona=' + encodeURIComponent(persona) : ''),
    );
  const nativeOrigin = process.env.PUBLIC_ORIGIN ?? 'http://localhost:8080',
    host = (await headers()).get('host'),
    nativeContactUrl =
      host && host !== new URL(nativeOrigin).host ? nativeOrigin + '/u/' + p.handle : undefined;
  const bio = p.claims.find((c) => c.key === 'core:bio')?.value,
    links = p.claims.find((c) => c.key === 'core:links')?.value as
      { label: string; url: string }[] | undefined,
    website = p.claims.find((c) => c.key === 'core:website')?.value;
  return (
    <>
      {p.headerUrl && (
        <img
          src={p.headerUrl}
          alt="Profile header"
          width={1024}
          height={320}
          className="profile-header-image"
        />
      )}
      <header className="public-header">
        <Brand />
        <nav aria-label="Public profile">
          <Link href={(process.env.PUBLIC_ORIGIN ?? 'http://localhost:8080') + '/login'}>
            Sign in
          </Link>
          <Link
            href={(process.env.PUBLIC_ORIGIN ?? 'http://localhost:8080') + '/register'}
            className="button primary compact"
          >
            Create your identity
          </Link>
        </nav>
      </header>
      <main id="main" className="profile-page">
        <article
          className={'public-profile card ' + (p.theme === 'dark' ? 'theme-dark' : '')}
          lang={p.locale}
          dir={localeDirection(p.locale)}
        >
          <div className="profile-header">
            <img
              src={p.avatarUrl + (p.avatarUrl.includes('?') ? '&' : '?') + 'size=256'}
              width={112}
              height={112}
              alt={p.displayName + ' avatar'}
            />
            <span className="tag">{p.type.toLowerCase()}</span>
            <h1 dir="auto">{p.displayName}</h1>
            <p className="muted">@{p.handle}</p>
          </div>
          {persona && <p className="profile-persona tag">Persona: {persona}</p>}
          {typeof bio === 'string' && (
            <p dir="auto" className="profile-bio">
              {bio}
            </p>
          )}
          <PublicBlocks profile={p} />
          <dl className="profile-fields">
            {p.claims
              .filter(
                (c) =>
                  !['core:display_name', 'core:bio', 'core:website', 'core:links'].includes(c.key),
              )
              .map((c) => (
                <div key={c.id}>
                  <dt>{c.key.split(':')[1]?.replaceAll('_', ' ')}</dt>
                  <dd dir="auto">
                    {Array.isArray(c.value) ? (
                      c.value.join(', ')
                    ) : typeof c.value === 'string' && c.value.startsWith('https://') ? (
                      <a href={c.value} rel="me noopener noreferrer" target="_blank">
                        {c.value}
                      </a>
                    ) : (
                      String(c.value ?? '')
                    )}
                  </dd>
                </div>
              ))}
          </dl>
          {typeof website === 'string' && (
            <a className="profile-link" href={website} target="_blank" rel="me noopener noreferrer">
              Website <ArrowUpRight size={17} />
            </a>
          )}
          {links?.map((l) => (
            <a
              className="profile-link"
              key={l.url + l.label}
              href={l.url}
              target="_blank"
              rel="me noopener noreferrer"
            >
              {l.label}
              <ArrowUpRight size={17} />
            </a>
          ))}
          <details className="profile-provenance">
            <summary>Information sources</summary>
            {p.claims.map((c) => (
              <p key={c.id}>
                <strong>{c.key.split(':')[1]?.replaceAll('_', ' ')}</strong>:{' '}
                {c.source.toLowerCase().replaceAll('_', ' ')} ·{' '}
                {c.verification.toLowerCase().replaceAll('_', ' ')} · {c.freshness}
              </p>
            ))}
          </details>
          {p.contactEnabled && (
            <ContactForm identityId={p.id} nativeContactUrl={nativeContactUrl} />
          )}
        </article>
        {p.machine && (
          <div className="actions center-actions">
            <a
              className="text-link small"
              href={
                '/api/v1/profiles/' +
                p.id +
                '/vcard' +
                (persona ? '?persona=' + encodeURIComponent(persona) : '')
              }
            >
              Save public contact
            </a>
            <a className="text-link small" href={'/api/v1/profiles/' + p.id + '?channel=machine'}>
              Machine-readable profile
            </a>
          </div>
        )}
      </main>
      <footer className="public-footer">
        <Brand />
        <span>A lasting identity. On your terms.</span>
        <Link href="/">Discover Orbit</Link>
      </footer>
    </>
  );
}
