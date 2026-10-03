'use client';
import type { PublicProfile } from './contracts.js';
import { useEffect, useRef, useId } from 'react';
function integrationOrigin(origin: string): string {
  const u = new URL(origin);
  if (
    u.username ||
    u.password ||
    (u.protocol !== 'https:' &&
      !(u.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(u.hostname)))
  )
    throw new Error('Use HTTPS or a loopback development origin without credentials');
  return u.origin;
}
export function ProfileHoverCard({ origin, profile }: { origin: string; profile: PublicProfile }) {
  return (
    <details>
      <summary>
        {profile.displayName} · @{profile.handle}
      </summary>
      <ProfileCard origin={origin} profile={profile} />
    </details>
  );
}
export function ConsentDialog({
  open,
  applicationName,
  purpose,
  fields,
  onApprove,
  onDeny,
}: {
  open: boolean;
  applicationName: string;
  purpose: string;
  fields: { key: string; label: string }[];
  onApprove: (fields: string[]) => void;
  onDeny: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null),
    title = useId();
  useEffect(() => {
    if (open && !ref.current?.open) ref.current?.showModal();
    if (!open && ref.current?.open) ref.current?.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      aria-labelledby={title}
      onCancel={(e) => {
        e.preventDefault();
        onDeny();
      }}
    >
      <h2 id={title}>Share with {applicationName}</h2>
      <p>{purpose}</p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const data = new FormData(e.currentTarget);
          onApprove(fields.filter((f) => data.has(f.key)).map((f) => f.key));
        }}
      >
        <fieldset>
          <legend>Choose the fields this application may read</legend>
          {fields.map((f) => (
            <label key={f.key}>
              <input type="checkbox" name={f.key} />
              {f.label}
            </label>
          ))}
        </fieldset>
        <button type="submit">Approve selected fields</button>
        <button type="button" onClick={onDeny}>
          Deny access
        </button>
      </form>
    </dialog>
  );
}
export function IdentityAvatar({
  origin,
  identityId,
  alt,
  size = 64,
}: {
  origin: string;
  identityId: string;
  alt: string;
  size?: number;
}) {
  const base = integrationOrigin(origin);
  if (!Number.isInteger(size) || size < 16 || size > 1024)
    throw new Error('Use avatar size 16–1024');
  return (
    <img
      src={base + '/avatar/' + encodeURIComponent(identityId) + '?size=' + size}
      width={size}
      height={size}
      alt={alt}
    />
  );
}
export function IdentityLink({
  origin,
  handle,
  children,
}: {
  origin: string;
  handle: string;
  children: React.ReactNode;
}) {
  return (
    <a href={new URL('/u/' + encodeURIComponent(handle), integrationOrigin(origin)).toString()}>
      {children}
    </a>
  );
}
export function ProfileCard({ origin, profile }: { origin: string; profile: PublicProfile }) {
  return (
    <article aria-label={profile.displayName}>
      <IdentityAvatar
        origin={origin}
        identityId={profile.id}
        alt={profile.displayName + ' avatar'}
      />
      <h2>
        <IdentityLink origin={origin} handle={profile.handle}>
          {profile.displayName}
        </IdentityLink>
      </h2>
      <p>@{profile.handle}</p>
    </article>
  );
}
export function PersonaPicker({
  personas,
  value,
  onChange,
}: {
  personas: { slug: string; name: string }[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label>
      Persona
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Base identity</option>
        {personas.map((p) => (
          <option key={p.slug} value={p.slug}>
            {p.name}
          </option>
        ))}
      </select>
    </label>
  );
}
