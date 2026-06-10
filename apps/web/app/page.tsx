// SPDX-License-Identifier: Apache-2.0
import { headers } from 'next/headers';
import Link from 'next/link';
import type { components } from '@document-chat/contracts';
import { getOptionalUser } from '../lib/auth';

// The frontend consumes the OpenAPI contract: the response is typed by the
// generated `VersionResponse` schema, so the page breaks at compile time if
// the contract changes shape. Tier 1 replaces this hand-rolled fetch with the
// generated client wrapped in TanStack Query.
type VersionResponse = components['schemas']['VersionResponse'];

// Read /api/version on every request (no static caching of build info).
export const dynamic = 'force-dynamic';

async function getVersion(): Promise<VersionResponse | null> {
  try {
    const headerList = await headers();
    const host = headerList.get('host');
    if (!host) return null;
    const protocol = headerList.get('x-forwarded-proto') ?? 'http';
    const res = await fetch(`${protocol}://${host}/api/version`, { cache: 'no-store' });
    if (!res.ok) return null;
    return (await res.json()) as VersionResponse;
  } catch {
    return null;
  }
}

export default async function Home() {
  const [version, user] = await Promise.all([getVersion(), getOptionalUser()]);

  return (
    <main>
      <h1>document-chat</h1>
      <p>Public Apache 2.0 starter for a document Q&amp;A system.</p>

      {user ? (
        <div>
          <span>Signed in as {user.email}</span>{' '}
          <form action="/auth/signout" method="post" style={{ display: 'inline' }}>
            <button type="submit">Sign out</button>
          </form>
          <p>
            <Link href="/documents">Documents</Link> · <Link href="/chats">Chats</Link>
          </p>
        </div>
      ) : (
        <p>
          <Link href="/login">Sign in</Link> · <Link href="/signup">Create account</Link>
        </p>
      )}

      {version ? (
        <dl>
          <dt>API version</dt>
          <dd>{version.api_version}</dd>
          <dt>Spec version</dt>
          <dd>{version.spec_version}</dd>
          <dt>Environment</dt>
          <dd>{version.environment}</dd>
          {version.git_sha ? (
            <>
              <dt>Commit</dt>
              <dd>
                <code>{version.git_sha}</code>
              </dd>
            </>
          ) : null}
        </dl>
      ) : (
        <p>
          Could not reach <code>/api/version</code>.
        </p>
      )}

      <p>
        Tier 0 endpoints: <code>/api/health</code>, <code>/api/version</code>.
      </p>
    </main>
  );
}
