'use client';
// SPDX-License-Identifier: Apache-2.0
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createBrowserSupabaseClient } from '../lib/supabase/client';

type Mode = 'login' | 'signup';

const COPY: Record<Mode, { heading: string; submit: string; altText: string; altHref: string; altLabel: string }> = {
  login: {
    heading: 'Sign in',
    submit: 'Sign in',
    altText: 'Need an account?',
    altHref: '/signup',
    altLabel: 'Create one',
  },
  signup: {
    heading: 'Create account',
    submit: 'Sign up',
    altText: 'Already have an account?',
    altHref: '/login',
    altLabel: 'Sign in',
  },
};

export function AuthForm({ mode }: { mode: Mode }) {
  const router = useRouter();
  const copy = COPY[mode];
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    setPending(true);

    const supabase = createBrowserSupabaseClient();
    if (mode === 'login') {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        setError(error.message);
        setPending(false);
        return;
      }
    } else {
      const { data, error } = await supabase.auth.signUp({ email, password });
      if (error) {
        setError(error.message);
        setPending(false);
        return;
      }
      // With email confirmations enabled there is no session yet.
      if (!data.session) {
        setNotice('Check your email to confirm your account, then sign in.');
        setPending(false);
        return;
      }
    }

    router.push('/');
    router.refresh();
  }

  return (
    <main>
      <h1>{copy.heading}</h1>
      <form onSubmit={onSubmit}>
        <label>
          Email
          <input
            type="email"
            name="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label>
          Password
          <input
            type="password"
            name="password"
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            required
            minLength={6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <button type="submit" disabled={pending}>
          {pending ? '…' : copy.submit}
        </button>
      </form>

      {error ? <p role="alert">{error}</p> : null}
      {notice ? <p>{notice}</p> : null}

      <p>
        {copy.altText} <Link href={copy.altHref}>{copy.altLabel}</Link>
      </p>
    </main>
  );
}
