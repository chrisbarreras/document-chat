// SPDX-License-Identifier: Apache-2.0
//
// Splits extracted document text into embedding-sized chunks (REQ-1.1.3):
// respects paragraph boundaries first, then sentences, then hard character
// windows for pathological input; configurable size + overlap; every chunk
// preserves its source location (page + character offsets into the document).
//
// Token counting is pluggable. The default is a cheap heuristic (~4 chars per
// token); the ingestion stage can inject a real tokenizer for the target
// embedding model. Pure and dependency-free so it's exhaustively unit-testable.

export interface SourcePage {
  /** 1-based page number (or any monotonic ordinal). */
  page: number;
  text: string;
}

export interface ChunkingOptions {
  /** Target maximum tokens per chunk. Default 800 (within REQ-1.1.3's 500–1000). */
  maxTokens?: number;
  /** Fraction of a chunk re-included at the start of the next, for context. Default 0.15. */
  overlapRatio?: number;
  /** Token estimator. Default: ~4 characters per token. */
  countTokens?: (text: string) => number;
}

export interface TextChunk {
  index: number;
  text: string;
  tokenCount: number;
  /** Inclusive start / exclusive end offsets into the concatenated document text. */
  charStart: number;
  charEnd: number;
  /** Page the chunk starts on, or null for non-paginated input. */
  pageNumber: number | null;
}

interface Range {
  start: number;
  end: number;
}

interface ResolvedOptions {
  maxTokens: number;
  overlapRatio: number;
  countTokens: (text: string) => number;
}

const PAGE_SEPARATOR = '\n\n';

const defaultCountTokens = (text: string): number =>
  Math.max(1, Math.ceil(text.trim().length / 4));

function resolveOptions(options?: ChunkingOptions): ResolvedOptions {
  const maxTokens = Math.max(1, Math.floor(options?.maxTokens ?? 800));
  const rawOverlap = options?.overlapRatio ?? 0.15;
  const overlapRatio = Math.min(0.9, Math.max(0, rawOverlap));
  return { maxTokens, overlapRatio, countTokens: options?.countTokens ?? defaultCountTokens };
}

/** Concatenate pages and provide a page lookup by character offset. */
function buildDocument(pages: SourcePage[]): {
  doc: string;
  pageAt: (offset: number) => number | null;
} {
  const ranges: Array<{ start: number; end: number; page: number }> = [];
  let doc = '';
  pages.forEach((p, i) => {
    const start = doc.length;
    doc += p.text;
    ranges.push({ start, end: doc.length, page: p.page });
    if (i < pages.length - 1) doc += PAGE_SEPARATOR;
  });

  const pageAt = (offset: number): number | null => {
    for (const r of ranges) {
      if (offset >= r.start && offset < r.end) return r.page;
    }
    // Offset landed in a separator: attribute it to the preceding page.
    for (let i = ranges.length - 1; i >= 0; i--) {
      const r = ranges[i];
      if (r && offset >= r.start) return r.page;
    }
    return ranges[0]?.page ?? null;
  };

  return { doc, pageAt };
}

/** Paragraph ranges (split on blank lines), trimmed to their non-whitespace content. */
function paragraphRanges(doc: string): Range[] {
  const ranges: Range[] = [];
  const breaks = /\n[ \t]*\n/g;
  let last = 0;
  let match: RegExpExecArray | null;
  const push = (start: number, end: number): void => {
    let s = start;
    let e = end;
    while (s < e && /\s/.test(doc.charAt(s))) s++;
    while (e > s && /\s/.test(doc.charAt(e - 1))) e--;
    if (e > s) ranges.push({ start: s, end: e });
  };
  while ((match = breaks.exec(doc)) !== null) {
    push(last, match.index);
    last = breaks.lastIndex;
  }
  push(last, doc.length);
  return ranges;
}

/** Contiguous sentence ranges within [start, end). */
function sentenceRanges(doc: string, start: number, end: number): Range[] {
  const text = doc.slice(start, end);
  const ranges: Range[] = [];
  const boundary = /[.!?]+(?:\s+|$)/g;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = boundary.exec(text)) !== null) {
    const stop = match.index + match[0].length;
    ranges.push({ start: start + last, end: start + stop });
    last = stop;
  }
  if (last < text.length) ranges.push({ start: start + last, end });
  return ranges.filter((r) => r.end > r.start);
}

/** Fixed-size character windows for a range that has no usable sub-boundaries. */
function hardWindows(start: number, end: number, maxChars: number): Range[] {
  const windows: Range[] = [];
  for (let i = start; i < end; i += maxChars) {
    windows.push({ start: i, end: Math.min(end, i + maxChars) });
  }
  return windows;
}

/** Break a range into atomic units each within the token budget. */
function atomicUnits(doc: string, range: Range, opts: ResolvedOptions): Range[] {
  if (opts.countTokens(doc.slice(range.start, range.end)) <= opts.maxTokens) {
    return [range];
  }
  const units: Range[] = [];
  for (const sentence of sentenceRanges(doc, range.start, range.end)) {
    if (opts.countTokens(doc.slice(sentence.start, sentence.end)) <= opts.maxTokens) {
      units.push(sentence);
    } else {
      units.push(...hardWindows(sentence.start, sentence.end, opts.maxTokens * 4));
    }
  }
  return units;
}

function packUnits(
  doc: string,
  units: Range[],
  pageAt: (offset: number) => number | null,
  opts: ResolvedOptions,
): TextChunk[] {
  const chunks: TextChunk[] = [];
  const n = units.length;
  let i = 0;
  let index = 0;

  while (i < n) {
    // Greedily accumulate units up to the token budget (always take at least one).
    let tokens = 0;
    let j = i;
    while (j < n) {
      const unit = units[j];
      if (!unit) break;
      const unitTokens = opts.countTokens(doc.slice(unit.start, unit.end));
      if (tokens > 0 && tokens + unitTokens > opts.maxTokens) break;
      tokens += unitTokens;
      j++;
    }

    const startUnit = units[i];
    const endUnit = units[j - 1];
    if (!startUnit || !endUnit) break;

    const charStart = startUnit.start;
    const charEnd = endUnit.end;
    const text = doc.slice(charStart, charEnd);
    chunks.push({
      index: index++,
      text,
      tokenCount: opts.countTokens(text),
      charStart,
      charEnd,
      pageNumber: pageAt(charStart),
    });

    if (j >= n) break;

    // Step back so the next chunk re-includes ~overlap tokens of trailing units.
    const overlapTokens = opts.maxTokens * opts.overlapRatio;
    let back = j - 1;
    let carried = 0;
    while (back > i && carried < overlapTokens) {
      const unit = units[back];
      if (!unit) break;
      carried += opts.countTokens(doc.slice(unit.start, unit.end));
      back--;
    }
    // Always advance at least one unit to guarantee progress.
    i = Math.max(back + 1, i + 1);
  }

  return chunks;
}

function chunkDocument(
  doc: string,
  pageAt: (offset: number) => number | null,
  options?: ChunkingOptions,
): TextChunk[] {
  const opts = resolveOptions(options);
  const units = paragraphRanges(doc).flatMap((range) => atomicUnits(doc, range, opts));
  if (units.length === 0) return [];
  return packUnits(doc, units, pageAt, opts);
}

/** Chunk page-segmented text (e.g. PDF extraction), preserving page numbers. */
export function chunkPages(pages: SourcePage[], options?: ChunkingOptions): TextChunk[] {
  const { doc, pageAt } = buildDocument(pages);
  return chunkDocument(doc, pageAt, options);
}

/** Chunk a single block of text with no page information. */
export function chunkText(text: string, options?: ChunkingOptions): TextChunk[] {
  return chunkDocument(text, () => null, options);
}
