// SPDX-License-Identifier: Apache-2.0
//
// Citation extraction from LLM output. The chat orchestrator instructs Claude
// to cite chunks using `[<chunk-uuid>]` markers. We post-process the
// accumulated content to (a) strip markers that point at chunks the retrieval
// step didn't surface (REQ-1.5.4: never surface a hallucinated citation), and
// (b) collect the distinct chunks the LLM actually referenced, in first-seen
// order, so each gets a stable `index` in the citations table.

/** Matches `[<uuid>]`, case-insensitive on the hex. */
const MARKER_RE =
  /\[([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\]/gi;

// Like MARKER_RE but also eats any whitespace immediately before the marker,
// so removing "claim [uuid]." yields "claim." rather than "claim ." Only used
// by stripCitationMarkers (extractCitations must preserve prose exactly).
const MARKER_WITH_LEADING_WS_RE =
  /\s*\[[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\]/gi;

/**
 * Strip all `[<uuid>]` citation markers (and the space they follow), leaving
 * the surrounding prose intact. Used when feeding prior assistant turns back as
 * conversation history — the chunk ids are this-turn-specific, so carrying them
 * forward is just noise.
 */
export function stripCitationMarkers(content: string): string {
  return content.replace(MARKER_WITH_LEADING_WS_RE, '');
}

export interface ExtractedCitations {
  /** Final content with invalid markers removed. */
  cleanedContent: string;
  /**
   * Citations actually referenced by valid markers, in first-seen order.
   * `index` matches the position in this array (0-based).
   */
  citations: ExtractedCitation[];
}

export interface ExtractedCitation {
  chunkId: string;
  /** First-seen ordinal, same as the array index. */
  index: number;
}

/**
 * Walk `content` once, normalize valid markers, strip invalid ones.
 *
 * `validChunkIds` is the set of chunk ids the retrieval step returned. A
 * marker referencing any other id is silently removed — leaving the
 * surrounding prose intact — per REQ-1.5.4.
 */
export function extractCitations(
  content: string,
  validChunkIds: Iterable<string>,
): ExtractedCitations {
  const valid = new Set<string>();
  for (const id of validChunkIds) valid.add(id.toLowerCase());

  const seen = new Map<string, number>();
  const citations: ExtractedCitation[] = [];

  const cleanedContent = content.replace(MARKER_RE, (match, idRaw: string) => {
    const id = idRaw.toLowerCase();
    if (!valid.has(id)) return '';
    if (!seen.has(id)) {
      const index = citations.length;
      seen.set(id, index);
      citations.push({ chunkId: id, index });
    }
    // Normalize the marker to lowercase so persisted content is canonical.
    return `[${id}]`;
  });

  return { cleanedContent, citations };
}
