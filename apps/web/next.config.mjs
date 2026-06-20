// SPDX-License-Identifier: Apache-2.0
import { config as loadEnv } from 'dotenv';
import { fileURLToPath } from 'node:url';

// Next only auto-loads env files from this app directory (apps/web), but our
// `.env.local` lives at the monorepo root (see README / .env.example). Load the
// root `.env.local` and `.env` here — before the build reads NEXT_PUBLIC_* for
// client inlining — so the documented root-level setup works. `override: false`
// (dotenv's default) keeps real environment vars winning (Vercel / CI), and a
// missing file is a silent no-op.
for (const file of ['.env.local', '.env']) {
  loadEnv({ path: fileURLToPath(new URL(`../../${file}`, import.meta.url)) });
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // OpenAPI custom-method paths use Google AIP-136 colon syntax (e.g.
  // `/api/citations:resolve`). The colon can't appear in a filesystem path
  // on Windows, so the route handlers live at Windows-safe folder names and
  // we rewrite the spec URL to them here. Keep this list in sync with the
  // openapi.yaml `paths:` entries that contain a colon.
  async rewrites() {
    return [
      { source: '/api/citations:resolve', destination: '/api/citations/resolve' },
      {
        source: '/api/documents/:document_id:reprocess',
        destination: '/api/documents/:document_id/reprocess',
      },
    ];
  },
};

export default nextConfig;
