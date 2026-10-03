'use client';
import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { startAuthentication } from '@simplewebauthn/browser';
import { api, message } from '../lib/api';
export function AuthForm({
  mode = 'login',
}: {
  mode?: 'login' | 'register' | 'recover' | 'reset';
}) {
  const [status, setStatus] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  function destination() {
    const value = new URLSearchParams(window.location.search).get('returnTo');
    return value && /^\/api\/v1\/oauth\/authorize\?/.test(value) ? value : '/dashboard';
  }
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setStatus('');
    const f = new FormData(e.currentTarget);
    try {
      if (mode === 'login') {
        await api('/auth/login', {
          method: 'POST',
          body: JSON.stringify({
            email: f.get('email'),
            password: f.get('password'),
            ...(f.get('code') ? { code: f.get('code') } : {}),
          }),
        });
        window.location.assign(destination());
      } else if (mode === 'register') {
        const result = await api<{ message: string }>('/auth/register', {
          method: 'POST',
          body: JSON.stringify({ email: f.get('email'), password: f.get('password') }),
        });
        setStatus(result.message);
      } else if (mode === 'recover') {
        const result = await api<{ message: string }>('/auth/recover', {
          method: 'POST',
          body: JSON.stringify({ email: f.get('email') }),
        });
        setStatus(result.message);
      } else {
        const token = new URLSearchParams(window.location.search).get('token');
        const result = await api<{ message: string }>('/auth/reset', {
          method: 'POST',
          body: JSON.stringify({
            token,
            password: f.get('password'),
            ...(f.get('code') ? { code: f.get('code') } : {}),
          }),
        });
        setStatus(result.message);
      }
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function passkey() {
    setBusy(true);
    setError('');
    try {
      const d = await api<{
        token: string;
        options: Parameters<typeof startAuthentication>[0]['optionsJSON'];
      }>('/auth/passkeys/authentication/options', { method: 'POST', body: '{}' });
      const response = await startAuthentication({ optionsJSON: d.options });
      await api('/auth/passkeys/authentication/verify', {
        method: 'POST',
        body: JSON.stringify({ token: d.token, response }),
      });
      window.location.assign(destination());
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form method="post" onSubmit={submit} className="stack auth-fields">
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
      {mode !== 'reset' && (
        <label>
          Email address
          <input name="email" type="email" autoComplete="email" required maxLength={254} />
        </label>
      )}
      {mode !== 'recover' && (
        <label>
          Password
          <input
            name="password"
            aria-label="Password"
            type="password"
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            required
            minLength={mode === 'login' ? 1 : 12}
            maxLength={128}
          />
          {mode !== 'login' && <span className="field-hint">Use at least 12 characters.</span>}
        </label>
      )}
      {(mode === 'login' || mode === 'reset') && (
        <label>
          Security or backup code <span className="optional">(if enabled)</span>
          <input name="code" autoComplete="one-time-code" maxLength={20} />
        </label>
      )}
      <button className="button primary" disabled={busy}>
        {busy
          ? 'Please wait…'
          : mode === 'login'
            ? 'Sign in'
            : mode === 'register'
              ? 'Create your account'
              : mode === 'recover'
                ? 'Send recovery link'
                : 'Change password'}
      </button>
      {mode === 'login' && (
        <>
          <button type="button" className="button secondary" disabled={busy} onClick={passkey}>
            Sign in with a passkey
          </button>
          <div className="between small">
            <Link href="/recover">Forgot your password?</Link>
            <Link href="/register">Create account</Link>
          </div>
        </>
      )}
      {mode !== 'login' && (
        <Link href="/login" className="small">
          Back to sign in
        </Link>
      )}
    </form>
  );
}
