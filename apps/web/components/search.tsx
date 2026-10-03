'use client';
import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { Search, ArrowUpRight } from 'lucide-react';
import { api, message } from '../lib/api';
export function SearchProfiles() {
  const [results, setResults] = useState<
      { id: string; handle: string; type: string; display_name: string }[]
    >([]),
    [error, setError] = useState(''),
    [searched, setSearched] = useState(false),
    [busy, setBusy] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const q = new FormData(e.currentTarget).get('q');
      const r = await api<{ items: typeof results }>('/search?q=' + encodeURIComponent(String(q)));
      setResults(r.items);
      setSearched(true);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="search-area">
      <form method="post" onSubmit={submit} className="search-form">
        <Search size={20} aria-hidden="true" />
        <label className="sr-only" htmlFor="profile-search">
          Search public profiles
        </label>
        <input
          id="profile-search"
          name="q"
          placeholder="Find a public identity"
          required
          minLength={2}
          maxLength={80}
        />
        <button className="button primary" disabled={busy}>
          {busy ? 'Searching…' : 'Search'}
        </button>
      </form>
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      {searched && (
        <div aria-live="polite">
          {results.length === 0 ? (
            <p className="muted">
              No discoverable profiles matched. Only profiles that opt into search appear here.
            </p>
          ) : (
            results.map((p) => (
              <Link className="search-result" href={'/u/' + p.handle} key={p.id}>
                <img src={'/avatar/' + p.id + '?size=64'} alt="" width={40} height={40} />
                <span>
                  <strong>{p.display_name}</strong>
                  <small>
                    @{p.handle} · {p.type.toLowerCase()}
                  </small>
                </span>
                <ArrowUpRight size={18} />
              </Link>
            ))
          )}
        </div>
      )}
    </div>
  );
}
