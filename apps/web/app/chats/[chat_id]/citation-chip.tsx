'use client';
// SPDX-License-Identifier: Apache-2.0

export interface CitationChipProps {
  label: string;
  onClick: () => void;
}

/**
 * Small inline button rendered in place of `[<chunk-uuid>]` markers. Plain
 * button + sup so the chip is keyboard-reachable and screenreaders announce
 * it as a reference link.
 */
export function CitationChip({ label, onClick }: CitationChipProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid="citation-chip"
      style={{
        background: '#eef',
        border: '1px solid #99c',
        borderRadius: '0.25rem',
        padding: '0 0.25rem',
        fontSize: '0.8em',
        cursor: 'pointer',
        margin: '0 0.125rem',
      }}
      aria-label={`Open citation ${label}`}
    >
      <sup>[{label}]</sup>
    </button>
  );
}
