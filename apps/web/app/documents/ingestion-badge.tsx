'use client';
// SPDX-License-Identifier: Apache-2.0
import { useIngestionStatus } from './use-ingestion-status';

export interface IngestionBadgeProps {
  documentId: string;
  initialState: string;
  initialError?: string | null;
  /** Append " — <error>" when the document failed. */
  showError?: boolean;
}

/**
 * Live ingestion-state badge. Renders the current state and advances it in
 * real time by subscribing to the SSE stream (no-op once terminal). Drop-in
 * replacement for the static `<span className="badge badge--{state}">` used in
 * the documents list and the detail-page header.
 */
export function IngestionBadge({
  documentId,
  initialState,
  initialError = null,
  showError = false,
}: IngestionBadgeProps) {
  const { state, error } = useIngestionStatus(documentId, initialState, initialError);
  return (
    <>
      <span className={`badge badge--${state}`} data-testid="ingestion-state">
        {state}
      </span>
      {showError && error ? <span className="muted"> — {error}</span> : null}
    </>
  );
}
