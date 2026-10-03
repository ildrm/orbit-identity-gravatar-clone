'use client';
import { useState, useEffect, type FormEvent } from 'react';
import Link from 'next/link';
import {
  LayoutDashboard,
  UserRound,
  Layers,
  Shield,
  ImageIcon,
  AppWindow,
  Users,
  KeyRound,
  Code2,
  Download,
  ExternalLink,
  ArrowRight,
  LogOut,
  Plus,
  Activity,
  Globe2,
} from 'lucide-react';
import {
  RevisionPanel,
  ImportPanel,
  StatePanel,
  ExtensionPanel,
  NotificationsPanel,
} from './portability-panels';
import { AccountPanel, LegacyPanel } from './lifecycle-panels';
import { ModerationPanel } from './moderation-panel';
import {
  CredentialsPanel,
  FederationPanel,
  WebProofsPanel,
  CustomDomainsPanel,
} from './trust-panels';
import { CompositionPanel, AnalyticsPanel } from './composition';
import { EnterprisePanel } from './enterprise';
import { MergePanel } from './merging';
import { ContactInbox } from './contact-inbox';
import { RelationshipsPanel } from './relationships';
import { ConnectionsPanel } from './connections';
import { Brand } from './brand';
import { api, message } from '../lib/api';
import { identityTypes, type PublicProfile } from '../../../packages/contracts/src/index';
import {
  ProfilePanel,
  PersonasPanel,
  PrivacyPanel,
  AvatarPanel,
  ApplicationsPanel,
  OrganizationPanel,
  SecurityPanel,
  ExportPanel,
  DomainsPanel,
  ActivityPanel,
} from './panels';
export interface Identity {
  id: string;
  handle: string;
  type: string;
  role: string;
  visibility: 'PUBLIC' | 'UNLISTED' | 'PRIVATE';
  searchable: boolean;
  indexable: boolean;
  machine: boolean;
  agent: boolean;
  theme: 'light' | 'dark';
  locale: string;
  revision: number;
  state: string;
  contact_enabled: boolean;
}
export interface Account {
  id: string;
  email: string;
  locale: string;
  timezone: string;
  totp_enabled: boolean;
}
const navigation = [
  ['overview', 'Overview', LayoutDashboard],
  ['profile', 'Profile', UserRound],
  ['personas', 'Personas', Layers],
  ['blocks', 'Profile blocks', Layers],
  ['analytics', 'Analytics', Activity],
  ['avatar', 'Avatar & media', ImageIcon],
  ['privacy', 'Privacy', Shield],
  ['applications', 'Applications', AppWindow],
  ['organizations', 'People & roles', Users],
  ['relationships', 'Relationships', Users],
  ['assertions', 'Organization assertions', Users],
  ['merging', 'Merging', Layers],
  ['credentials', 'DIDs & credentials', KeyRound],
  ['federation', 'Federation', Globe2],
  ['connections', 'Connections', Globe2],
  ['contact', 'Contact inbox', UserRound],
  ['domains', 'Verification', Globe2],
  ['security', 'Security', KeyRound],
  ['account', 'Account settings', UserRound],
  ['legacy', 'Digital legacy', Shield],
  ['developer', 'Developer', Code2],
  ['exports', 'Export & sharing', Download],
  ['activity', 'Activity', Activity],
] as const;
export function Dashboard({ account }: { account: Account }) {
  const [identities, setIdentities] = useState<Identity[]>([]),
    [selected, setSelected] = useState(''),
    [tab, setTab] = useState('overview'),
    [profile, setProfile] = useState<PublicProfile | null>(null),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(true),
    [creating, setCreating] = useState(false);
  const current = identities.find((i) => i.id === selected);
  async function refresh() {
    try {
      const list = await api<Identity[]>('/identities');
      setIdentities(list);
      setSelected((value) => (list.some((i) => i.id === value) ? value : (list[0]?.id ?? '')));
    } catch (e) {
      setError(message(e));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void refresh();
  }, []);
  useEffect(() => {
    setProfile(null);
    setError('');
    if (selected)
      api<PublicProfile>('/identities/' + selected)
        .then(setProfile)
        .catch((e) => setError(message(e)));
  }, [selected]);
  async function reload() {
    await refresh();
    if (selected) setProfile(await api<PublicProfile>('/identities/' + selected));
  }
  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setError('');
    try {
      const result = await api<PublicProfile>('/identities', {
        method: 'POST',
        body: JSON.stringify({
          displayName: f.get('displayName'),
          handle: f.get('handle'),
          type: f.get('type'),
          visibility: 'PRIVATE',
        }),
      });
      await refresh();
      setSelected(result.id);
      setCreating(false);
      setTab('profile');
    } catch (e) {
      setError(message(e));
    }
  }
  async function logout() {
    try {
      await api('/auth/logout', { method: 'POST', body: '{}' });
      window.location.assign('/login');
    } catch (e) {
      setError(message(e));
    }
  }
  return (
    <div className="dashboard-shell">
      <aside className="sidebar">
        <Brand />
        <div className="workspace-switch">
          <span className="eyebrow">YOUR WORKSPACE</span>
          <label className="sr-only" htmlFor="identity-select">
            Active identity
          </label>
          <select
            id="identity-select"
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
          >
            {identities.length === 0 ? (
              <option value="">Create an identity</option>
            ) : (
              identities.map((i) => (
                <option value={i.id} key={i.id}>
                  @{i.handle}
                </option>
              ))
            )}
          </select>
          <button className="add-identity" onClick={() => setCreating(true)}>
            <Plus size={15} /> New identity
          </button>
        </div>
        <nav aria-label="Identity dashboard">
          {navigation.map(([key, label, Icon]) => (
            <button
              key={key}
              className={'nav-item ' + (tab === key ? 'active' : '')}
              onClick={() => setTab(key)}
              aria-current={tab === key ? 'page' : undefined}
            >
              <Icon size={18} />
              {label}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="account-label">
            <span className="account-avatar">{account.email.slice(0, 1).toUpperCase()}</span>
            <span>
              <strong>Your account</strong>
              <small>{account.email}</small>
            </span>
          </div>
          <button className="nav-item" onClick={logout}>
            <LogOut size={17} /> Sign out
          </button>
        </div>
      </aside>
      <div className="workspace">
        <header className="workspace-header">
          <span>{navigation.find((n) => n[0] === tab)?.[1] ?? 'Overview'}</span>
          <div className="actions">
            {current && (
              <span
                className={'visibility-pill ' + (current.visibility === 'PUBLIC' ? 'public' : '')}
              >
                <Shield size={13} />
                {current.visibility.toLowerCase()}
              </span>
            )}
            {current && current.visibility !== 'PRIVATE' && (
              <Link href={'/u/' + current.handle} target="_blank" className="text-link small">
                View profile <ExternalLink size={14} />
              </Link>
            )}
          </div>
        </header>
        <main id="main" className="dashboard-main">
          {error && (
            <p className="notice error" role="alert">
              {error}
            </p>
          )}
          {loading ? (
            <p role="status">Loading your workspace…</p>
          ) : creating || identities.length === 0 ? (
            <section className="onboarding card">
              <span className="eyebrow">A PERMANENT HOME</span>
              <h1>Create your first identity.</h1>
              <p className="muted">Start private. Add your profile, then choose what to publish.</p>
              <form method="post" onSubmit={create} className="stack">
                <label>
                  Display name
                  <input
                    name="displayName"
                    required
                    maxLength={120}
                    placeholder="The name you go by"
                    autoComplete="nickname"
                  />
                </label>
                <label>
                  Handle
                  <div className="input-prefix">
                    <span>@</span>
                    <input
                      name="handle"
                      required
                      pattern="[a-z][a-z0-9_]{2,29}"
                      minLength={3}
                      maxLength={30}
                      placeholder="your_handle"
                    />
                  </div>
                  <span className="field-hint">
                    3–30 lowercase letters, numbers or underscores. Historical handles stay
                    reserved.
                  </span>
                </label>
                <label>
                  Identity type
                  <select name="type">
                    {identityTypes.map((t) => (
                      <option key={t} value={t}>
                        {t.charAt(0) + t.slice(1).toLowerCase()}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="actions">
                  <button className="button primary">
                    Create identity <ArrowRight size={16} />
                  </button>
                  {identities.length > 0 && (
                    <button
                      className="button secondary"
                      type="button"
                      onClick={() => setCreating(false)}
                    >
                      Cancel
                    </button>
                  )}
                </div>
              </form>
            </section>
          ) : current ? (
            <>
              {tab === 'overview' && (
                <>
                  <div className="page-heading">
                    <span className="eyebrow">YOUR IDENTITY, ON YOUR TERMS</span>
                    <h1>Welcome to your orbit.</h1>
                    <p>One lasting identity. A little more control over how you show up.</p>
                  </div>
                  <section className="overview-grid">
                    <article className="identity-card card">
                      <div className="between">
                        <span className="eyebrow">ACTIVE IDENTITY</span>
                        <span className="tag">{current.type.toLowerCase()}</span>
                      </div>
                      <div className="identity-card-person">
                        <img
                          src={'/avatar/' + current.id + '?size=256'}
                          width={88}
                          height={88}
                          alt="Your identity avatar"
                        />
                        <div>
                          <h2 dir="auto">{profile?.displayName ?? current.handle}</h2>
                          <p>@{current.handle}</p>
                        </div>
                      </div>
                      <p className="identity-id">{current.id}</p>
                      <div className="between">
                        <span className="muted small">Revision {current.revision}</span>
                        <button className="text-link" onClick={() => setTab('profile')}>
                          Edit profile <ArrowRight size={16} />
                        </button>
                      </div>
                    </article>
                    <article className="sharing-card card">
                      <Shield size={24} />
                      <h2>Share with intention.</h2>
                      <p>
                        {current.visibility === 'PRIVATE'
                          ? 'Your profile is private. Build it at your own pace, then publish when you are ready.'
                          : current.visibility === 'UNLISTED'
                            ? 'Anyone with your profile address can view public fields. Your profile stays out of platform search.'
                            : 'Your profile is published. Each field still follows its own privacy policy.'}
                      </p>
                      <button className="button secondary" onClick={() => setTab('privacy')}>
                        Review privacy <ArrowRight size={16} />
                      </button>
                    </article>
                  </section>
                  <h2 className="section-heading">Make your identity feel like you</h2>
                  <section className="quick-grid">
                    {[
                      [
                        'personas',
                        'Different contexts, same you',
                        'Create a persona for your professional or personal life.',
                        Layers,
                      ],
                      [
                        'avatar',
                        'A face for your identity',
                        'Upload an image or use your stable generated avatar.',
                        ImageIcon,
                      ],
                      [
                        'applications',
                        'Connect on your terms',
                        'Review what each application is allowed to access.',
                        AppWindow,
                      ],
                    ].map(([key, title, copy, Icon]) => (
                      <button
                        className="quick-card card"
                        key={String(key)}
                        onClick={() => setTab(String(key))}
                      >
                        {typeof Icon !== 'string' && <Icon size={23} />}
                        <h3>{String(title)}</h3>
                        <p>{String(copy)}</p>
                        <ArrowRight size={18} />
                      </button>
                    ))}
                  </section>
                </>
              )}
              {tab === 'profile' && (
                <ProfilePanel key={current.id} identity={current} refresh={reload} />
              )}
              {tab === 'personas' && <PersonasPanel key={current.id} identity={current} />}
              {tab === 'privacy' && (
                <PrivacyPanel key={current.id} identity={current} refresh={reload} />
              )}
              {tab === 'avatar' && (
                <AvatarPanel key={current.id} identity={current} refresh={reload} />
              )}
              {tab === 'applications' && <ApplicationsPanel key={current.id} identity={current} />}
              {tab === 'organizations' && <OrganizationPanel key={current.id} identity={current} />}
              {tab === 'relationships' && (
                <RelationshipsPanel key={current.id} identity={current} />
              )}
              {tab === 'blocks' && <CompositionPanel key={current.id} identity={current} />}
              {tab === 'analytics' && <AnalyticsPanel key={current.id} identity={current} />}
              {tab === 'assertions' && <EnterprisePanel key={current.id} identity={current} />}
              {tab === 'merging' && <MergePanel key={current.id} identity={current} />}
              {tab === 'credentials' && <CredentialsPanel key={current.id} identity={current} />}
              {tab === 'federation' && <FederationPanel key={current.id} identity={current} />}
              {tab === 'connections' && <ConnectionsPanel key={current.id} identity={current} />}
              {tab === 'contact' && <ContactInbox key={current.id} identity={current} />}
              {tab === 'domains' && (
                <div className="stack">
                  <DomainsPanel key={current.id} identity={current} />
                  <CustomDomainsPanel identity={current} />
                  <WebProofsPanel identity={current} />
                </div>
              )}
              {tab === 'security' && <SecurityPanel key={current.id} account={account} />}
              {tab === 'account' && (
                <div className="stack">
                  <AccountPanel account={account} />
                  <NotificationsPanel />
                </div>
              )}
              {tab === 'legacy' && <LegacyPanel key={current.id} identity={current} />}
              {tab === 'exports' && (
                <div className="stack">
                  <ExportPanel key={current.id} identity={current} />
                  <ImportPanel identity={current} />
                  <StatePanel identity={current} />
                  <ModerationPanel identity={current} />
                </div>
              )}
              {tab === 'activity' && (
                <div className="stack">
                  <ActivityPanel key={current.id} identity={current} />
                  <RevisionPanel identity={current} />
                </div>
              )}
              {tab === 'developer' && (
                <div className="stack">
                  <div className="page-heading">
                    <span className="eyebrow">BUILD WITH ORBIT</span>
                    <h1>A small API. A lasting identity.</h1>
                    <p>Register applications, grant granular access, and connect your tools.</p>
                  </div>
                  <article className="card">
                    <h2>Get started</h2>
                    <ol className="steps">
                      <li>Create an application in Applications.</li>
                      <li>Grant access to a specific identity, persona, scope and field list.</li>
                      <li>Use the resulting consent token with the native API.</li>
                    </ol>
                    <pre>
                      <code>
                        {'GET /api/v1/application/profile\nAuthorization: Bearer <consent-token>'}
                      </code>
                    </pre>
                    <Link href="/developers" className="button primary">
                      Read integration guide <ExternalLink size={16} />
                    </Link>
                  </article>
                  <article className="card">
                    <ExtensionPanel identity={current} />
                    <h2>Generated avatar</h2>
                    <pre>
                      <code>
                        {'/avatar/' + current.id + '?size=128&default=geometric&format=webp'}
                      </code>
                    </pre>
                    <p className="muted">
                      Native opaque IDs and handles are supported. Public email-hash lookup is
                      disabled.
                    </p>
                  </article>
                </div>
              )}
            </>
          ) : null}
        </main>
        <footer className="workspace-footer">
          <span>Orbit Identity</span>
          <span>
            <Shield size={12} /> You are in control.
          </span>
        </footer>
      </div>
    </div>
  );
}
