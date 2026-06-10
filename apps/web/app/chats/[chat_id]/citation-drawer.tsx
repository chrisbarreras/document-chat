'use client';
// SPDX-License-Identifier: Apache-2.0
import { useEffect, useState } from 'react';
import type { components } from '@document-chat/contracts';

type Citation = components['schemas']['Citation'];

export interface CitationDrawerProps {
  chunkId: string;
  onClose: () => void;
}

/**
 * Hydrates one citation by calling `POST /citations:resolve` and renders
 * the source title + page + excerpt. Closes when the user dismisses it.
 */
export function CitationDrawer({ chunkId, onClose }: CitationDrawerProps) {
  const [citation, setCitation] = useState<Citation | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let aborted = false;
    setCitation(null);
    setError(null);
    fetch('/api/citations:resolve', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chunk_ids: [chunkId] }),
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = (await res.json()) as { citations: Citation[] };
        if (aborted) return;
        const first = body.citations[0];
        if (!first) throw new Error('No citation returned.');
        setCitation(first);
      })
      .catch((err: unknown) => {
        if (aborted) return;
        setError(err instanceof Error ? err.message : 'Could not load citation.');
      });
    return () => {
      aborted = true;
    };
  }, [chunkId]);

  return (
    <aside
      data-testid="citation-drawer"
      style={{
        position: 'fixed',
        top: 0,
        right: 0,
        width: '24rem',
        maxWidth: '100%',
        height: '100vh',
        background: '#fff',
        borderLeft: '1px solid #ccc',
        padding: '1.5rem',
        boxShadow: '-4px 0 16px rgba(0,0,0,0.08)',
        overflowY: 'auto',
      }}
    >
      <button type="button" onClick={onClose} aria-label="Close citation">
        Close
      </button>
      {error ? (
        <p role="alert">{error}</p>
      ) : citation ? (
        citation.unavailable ? (
          <p>
            <em>{citation.unavailable_reason ?? 'Source is no longer available.'}</em>
          </p>
        ) : (
          <>
            <h3>{citation.document_title}</h3>
            <p>
              <small>
                v{citation.document_version}
                {citation.page_number !== null && citation.page_number !== undefined
                  ? ` · page ${citation.page_number}`
                  : ''}
              </small>
            </p>
            <blockquote
              style={{
                borderLeft: '4px solid #99c',
                paddingLeft: '0.75rem',
                margin: '0.5rem 0',
                whiteSpace: 'pre-wrap',
              }}
            >
              {citation.excerpt}
            </blockquote>
          </>
        )
      ) : (
        <p>Loading citation…</p>
      )}
    </aside>
  );
}
