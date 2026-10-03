'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { api, message } from '../lib/api';
export function Verify({ invitation = false }: { invitation?: boolean }) {
  const [state, setState] = useState(''),
    [error, setError] = useState('');
  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get('token');
    if (!token) {
      setError('This link is missing its verification token.');
      return;
    }
    api<{ message?: string }>(invitation ? '/invitations/accept' : '/auth/verify', {
      method: 'POST',
      body: JSON.stringify({ token }),
    })
      .then((d) => setState(d.message ?? 'Invitation accepted.'))
      .catch((e) => setError(message(e)));
  }, [invitation]);
  return (
    <div className="stack">
      {error ? (
        <p role="alert" className="notice error">
          {error}
        </p>
      ) : (
        <p role="status">{state || 'Checking your link…'}</p>
      )}
      <Link className="button primary" href={invitation ? '/dashboard' : '/login'}>
        {invitation ? 'Go to dashboard' : 'Sign in'}
      </Link>
    </div>
  );
}
