'use client';
import { useState, type FormEvent } from 'react';
import { api, message } from '../lib/api';
type Media = { id: string; status: string; purpose: string; alt: string };
export function AvatarTools({
  identityId,
  media,
  reload,
}: {
  identityId: string;
  media: Media[];
  reload: () => Promise<void>;
}) {
  const [error, setError] = useState(''),
    [status, setStatus] = useState(''),
    [busy, setBusy] = useState(false);
  const ready = media.filter((m) => m.status === 'READY');
  async function edit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const f = new FormData(e.currentTarget),
        color = String(f.get('removeColor') ?? ''),
        background = String(f.get('background') ?? '');
      const result = await api<{ id: string }>(
        '/identities/' + identityId + '/media/' + f.get('media') + '/edit',
        {
          method: 'POST',
          body: JSON.stringify({
            alt: f.get('alt'),
            transforms: {
              rotation: Number(f.get('rotation')),
              focal: { x: Number(f.get('focalX')) / 100, y: Number(f.get('focalY')) / 100 },
              ...(f.get('crop')
                ? {
                    crop: {
                      x: Number(f.get('cropX')) / 100,
                      y: Number(f.get('cropY')) / 100,
                      width: Number(f.get('cropWidth')) / 100,
                      height: Number(f.get('cropHeight')) / 100,
                    },
                  }
                : {}),
              ...(color ? { removeColor: color } : {}),
              ...(background ? { background } : {}),
              quality: Number(f.get('quality')),
            },
          }),
        },
      );
      await reload();
      setStatus(
        'Edited version ' + result.id + ' is processing. Refresh its status before activation.',
      );
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function schedule(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const f = new FormData(e.currentTarget),
        end = String(f.get('ends') ?? ''),
        context = String(f.get('context')),
        target = String(f.get('target') ?? '');
      await api('/identities/' + identityId + '/avatar-selections', {
        method: 'POST',
        body: JSON.stringify({
          mediaId: f.get('media'),
          startsAt: new Date(String(f.get('starts'))).toISOString(),
          endsAt: end ? new Date(end).toISOString() : null,
          context,
          applicationId: context === 'APPLICATION' ? target : null,
          domainId: context === 'DOMAIN' ? target : null,
        }),
      });
      setStatus(
        'Avatar selection scheduled. Temporary selections return to your base avatar automatically.',
      );
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function cancel(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError('');
    try {
      const f = new FormData(e.currentTarget);
      await api('/identities/' + identityId + '/avatar-selections/' + f.get('selection'), {
        method: 'DELETE',
      });
      setStatus('Avatar selection cancelled.');
    } catch (e) {
      setError(message(e));
    }
  }
  return (
    <article className="card stack">
      <h2>Edit and schedule avatars</h2>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {status && <p role="status">{status}</p>}
      <form className="stack" method="post" onSubmit={edit}>
        <h3>Create an edited version</h3>
        <label>
          Validated image
          <select name="media" required>
            {ready.map((m) => (
              <option key={m.id} value={m.id}>
                {m.alt}
              </option>
            ))}
          </select>
        </label>
        <label>
          Alternative text
          <input name="alt" required maxLength={200} />
        </label>
        <div className="form-grid">
          <label>
            Rotation
            <select name="rotation">
              {[0, 90, 180, 270].map((n) => (
                <option key={n}>{n}</option>
              ))}
            </select>
          </label>
          <label>
            WebP quality
            <input name="quality" type="number" min={60} max={95} defaultValue={85} />
          </label>
          <label>
            Focal point across (%)
            <input name="focalX" type="number" min={0} max={100} defaultValue={50} />
          </label>
          <label>
            Focal point down (%)
            <input name="focalY" type="number" min={0} max={100} defaultValue={50} />
          </label>
        </div>
        <label className="check">
          <input name="crop" type="checkbox" />
          Apply crop
        </label>
        <div className="form-grid">
          {[
            ['cropX', 'Crop left', 0],
            ['cropY', 'Crop top', 0],
            ['cropWidth', 'Crop width', 100],
            ['cropHeight', 'Crop height', 100],
          ].map(([name, label, value]) => (
            <label key={String(name)}>
              {label} (%)
              <input
                name={String(name)}
                type="number"
                min={0}
                max={100}
                defaultValue={Number(value)}
              />
            </label>
          ))}
        </div>
        <label>
          Remove a solid background color
          <input name="removeColor" placeholder="#ffffff" pattern="#[a-fA-F0-9]{6}" />
        </label>
        <p className="field-hint">
          Color removal suits solid backgrounds. Transparent areas remain transparent unless you
          choose a replacement color.
        </p>
        <label>
          Replacement background color
          <input name="background" placeholder="#5755d9" pattern="#[a-fA-F0-9]{6}" />
        </label>
        <button className="button secondary" disabled={busy || !ready.length}>
          Process edited version
        </button>
      </form>
      <form className="stack" method="post" onSubmit={schedule}>
        <h3>Schedule or override an avatar</h3>
        <label>
          Avatar
          <select name="media" required>
            {ready
              .filter((m) => m.purpose === 'AVATAR')
              .map((m) => (
                <option key={m.id} value={m.id}>
                  {m.alt}
                </option>
              ))}
          </select>
        </label>
        <label>
          Context
          <select name="context">
            <option value="DEFAULT">Default avatar</option>
            <option value="APPLICATION">Application override</option>
            <option value="DOMAIN">Verified domain override</option>
          </select>
        </label>
        <label>
          Application or verified domain ID
          <input name="target" maxLength={100} />
        </label>
        <label>
          Start (your local time)
          <input name="starts" type="datetime-local" required />
        </label>
        <label>
          End (leave empty for an ongoing selection)
          <input name="ends" type="datetime-local" />
        </label>
        <button className="button secondary" disabled={busy}>
          Save avatar selection
        </button>
      </form>
      <form className="stack" method="post" onSubmit={cancel}>
        <h3>Cancel a selection</h3>
        <button
          type="button"
          className="button secondary"
          onClick={async () => {
            try {
              const rows = await api<
                {
                  id: string;
                  revoked_at: string | null;
                  starts_at: string;
                  ends_at: string | null;
                }[]
              >('/identities/' + identityId + '/avatar-selections');
              setStatus(
                rows
                  .filter((r) => !r.revoked_at)
                  .map((r) => r.id + ' · ' + r.starts_at + ' → ' + (r.ends_at ?? 'ongoing'))
                  .join('\n') || 'No current selections.',
              );
            } catch (e) {
              setError(message(e));
            }
          }}
        >
          Show selection IDs and intervals
        </button>
        <label>
          Selection ID
          <input name="selection" required pattern="avs_[a-f0-9]{32}" />
        </label>
        <button className="button secondary">Cancel selection</button>
      </form>
    </article>
  );
}
