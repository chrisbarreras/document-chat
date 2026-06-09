// SPDX-License-Identifier: Apache-2.0
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
    ];
  },
};

export default nextConfig;
