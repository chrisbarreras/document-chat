// SPDX-License-Identifier: Apache-2.0
//
// Guards the AIP-136 colon custom-method rewrites in next.config.mjs. These
// map spec URLs like `/api/documents/{id}:reprocess` onto the Windows-safe
// `/reprocess` route folder. The trap: two adjacent path-to-regexp params
// (`:document_id:reprocess`) split the segment greedily, so `document_id`
// captured only the first character and reprocess 404'd. We compile the real
// rewrite source with Next's own matcher and assert the full id survives.
import { describe, it, expect } from 'vitest';
// Use the exact path-to-regexp Next bundles, so this test compiles the rewrite
// `source` the same way the real router does. It ships no type declarations.
// @ts-expect-error - no types for Next's bundled path-to-regexp
import * as ptr from 'next/dist/compiled/path-to-regexp';
import nextConfig from './next.config.mjs';

// The bundled module is CJS; named export under interop or on the namespace.
/* eslint-disable @typescript-eslint/no-explicit-any */
const pathToRegexp = ((ptr as any).pathToRegexp ?? (ptr as any).default?.pathToRegexp ?? ptr) as (
  source: string,
  keys?: unknown[],
) => RegExp;
/* eslint-enable @typescript-eslint/no-explicit-any */

async function rewriteRules() {
  const rewrites = await nextConfig.rewrites!();
  return Array.isArray(rewrites) ? rewrites : (rewrites.beforeFiles ?? []);
}

function capture(source: string, url: string): Record<string, string> | null {
  const keys: Array<{ name: string | number }> = [];
  const re = pathToRegexp(source, keys);
  const m = re.exec(url);
  if (!m) return null;
  return Object.fromEntries(keys.map((k, i) => [String(k.name), m[i + 1] ?? '']));
}

describe('next.config colon custom-method rewrites', () => {
  it('captures the FULL document_id for /api/documents/{uuid}:reprocess', async () => {
    const rules = await rewriteRules();
    const rule = rules.find((r) => r.destination.includes('/reprocess'));
    expect(rule, 'reprocess rewrite rule should exist').toBeTruthy();

    const uuid = 'b71e676f-6a2a-4164-9234-bb159d73a429';
    const params = capture(rule!.source, `/api/documents/${uuid}:reprocess`);
    expect(params).not.toBeNull();
    // Regression: this used to be "b" because the params split greedily.
    expect(params!.document_id).toBe(uuid);
  });

  it('does not match a plain document URL (no :reprocess suffix)', async () => {
    const rules = await rewriteRules();
    const rule = rules.find((r) => r.destination.includes('/reprocess'));
    const params = capture(rule!.source, '/api/documents/b71e676f-6a2a-4164-9234-bb159d73a429');
    expect(params).toBeNull();
  });
});
