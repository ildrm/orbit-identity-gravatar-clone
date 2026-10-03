'use client';
import { useEffect, useState, type FormEvent } from 'react';
import { api, message } from '../lib/api';
interface Details {
  id: string;
  redirect_uri: string;
  scopes: string[];
  fields: string[];
  application: { id: string; name: string; purpose: string };
  identities: { id: string; handle: string; role: string; state: string }[];
}
export function OAuthConsent({ requestId }: { requestId: string }) {
  const [details, setDetails] = useState<Details | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [identity, setIdentity] = useState(''),
    [personas, setPersonas] = useState<{ id: string; name: string; active: boolean }[]>([]);
  useEffect(() => {
    api<Details>('/oauth/requests/' + requestId)
      .then((d) => {
        setDetails(d);
        setIdentity(d.identities.find((i) => i.role === 'OWNER' && i.state === 'ACTIVE')?.id ?? '');
      })
      .catch((e) => setError(message(e)));
  }, [requestId]);
  useEffect(() => {
    setPersonas([]);
    if (identity)
      api<typeof personas>('/identities/' + identity + '/personas')
        .then(setPersonas)
        .catch((e) => setError(message(e)));
  }, [identity]);
  async function decide(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const f = new FormData(e.currentTarget),
      approve = (e.nativeEvent as SubmitEvent).submitter?.getAttribute('value') === 'approve';
    try {
      const selected = f.getAll('scopes') as string[];
      const result = await api<{ redirect: string }>('/oauth/requests/' + requestId + '/decision', {
        method: 'POST',
        body: JSON.stringify({
          approve,
          ...(approve
            ? {
                identityId: identity,
                personaId: f.get('persona') || null,
                scopes: selected,
                fields: f.getAll('fields'),
                shareEmail: f.get('shareEmail') === 'on',
                days: Number(f.get('days')),
              }
            : {}),
        }),
      });
      window.location.assign(result.redirect);
    } catch (e) {
      setError(message(e));
      setBusy(false);
    }
  }
  return (
    <section className="auth-card stack">
      <span className="eyebrow">APPLICATION ACCESS</span>
      <h1>Choose what to share.</h1>
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      {!details && !error && <p role="status">Loading the authorization request…</p>}
      {details && (
        <form method="post" onSubmit={decide} className="stack">
          <p>
            <strong>{details.application.name}</strong> requests access to your identity.
          </p>
          <p className="muted">{details.application.purpose}</p>
          <p className="small">
            Return address: <span className="mono">{details.redirect_uri}</span>
          </p>
          <label>
            Identity
            <select
              name="identity"
              value={identity}
              onChange={(e) => setIdentity(e.target.value)}
              required
            >
              <option value="">Choose an identity</option>
              {details.identities
                .filter((i) => i.role === 'OWNER' && i.state === 'ACTIVE')
                .map((i) => (
                  <option value={i.id} key={i.id}>
                    @{i.handle}
                  </option>
                ))}
            </select>
          </label>
          <label>
            Persona
            <select name="persona" key={identity}>
              <option value="">Default profile</option>
              {personas
                .filter((p) => p.active)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
            </select>
          </label>
          <fieldset className="stack">
            <legend>Requested permissions</legend>
            {details.scopes.map((s) => (
              <label className="check" key={s}>
                <input
                  type="checkbox"
                  name="scopes"
                  value={s}
                  defaultChecked={s === 'identity.read'}
                />{' '}
                {s}
              </label>
            ))}
          </fieldset>
          <fieldset className="stack">
            <legend>Requested fields</legend>
            {details.fields.map((f) => (
              <label className="check" key={f}>
                <input type="checkbox" name="fields" value={f} /> {f}
              </label>
            ))}
          </fieldset>
          {details.scopes.includes('email.read') && (
            <label className="check">
              <input type="checkbox" name="shareEmail" />
              Share my verified account email address
            </label>
          )}
          <label>
            Access expires
            <select name="days" defaultValue="30">
              <option value="1">In one day</option>
              <option value="30">In 30 days</option>
              <option value="90">In 90 days</option>
            </select>
          </label>
          <p className="muted small">
            Field privacy and transformations apply to every request. Revoke access in Applications
            at any time. Offline access allows this application to refresh its tokens until your
            consent expires.
          </p>
          <div className="actions">
            <button
              name="decision"
              value="approve"
              className="button primary"
              disabled={busy || !identity}
            >
              Allow selected access
            </button>
            <button
              name="decision"
              value="deny"
              className="button secondary"
              disabled={busy}
              formNoValidate
            >
              Deny
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
