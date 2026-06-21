'use client';
// SPDX-License-Identifier: Apache-2.0
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Bump a version string for a new upload: increment the leading integer and
 * reset the minor (1.0 → 2.0, 3.7 → 4.0). Non-numeric versions get a `-v2`
 * suffix as a fallback.
 */
export function bumpVersion(version: string): string {
  const match = /^(\d+)/.exec(version.trim());
  return match ? `${Number(match[1]) + 1}.0` : `${version.trim() || '1'}-v2`;
}

async function readDetail(res: Response, fallback: string): Promise<string> {
  try {
    const body = await res.json();
    return typeof body?.detail === 'string' ? body.detail : fallback;
  } catch {
    return fallback;
  }
}

/** Upload one PDF through sign → PUT → finalize; resolves with the new doc id. */
async function uploadOne(file: File, title: string): Promise<string> {
  const contentType = file.type || 'application/pdf';
  const uploadRes = await fetch('/api/documents/uploads', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ filename: file.name, size_bytes: file.size, content_type: contentType }),
  });
  if (!uploadRes.ok) throw new Error(await readDetail(uploadRes, 'Could not start the upload.'));
  const { upload_id, signed_url } = await uploadRes.json();

  const putRes = await fetch(signed_url, { method: 'PUT', body: file, headers: { 'content-type': contentType } });
  if (!putRes.ok) throw new Error('Uploading the file to storage failed.');

  const finalizeRes = await fetch('/api/documents', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ upload_id, title }),
  });
  if (!finalizeRes.ok) throw new Error(await readDetail(finalizeRes, 'Could not finalize the document.'));
  const created = (await finalizeRes.json().catch(() => ({}))) as { id?: string };
  if (!created.id) throw new Error('Finalize did not return a document id.');
  return created.id;
}

export interface NewVersionUploaderProps {
  documentId: string;
  title: string;
  version: string;
}

/**
 * Upload a replacement PDF as a new version of this document. Tier-1 stopgap:
 * it uploads a fresh document inheriting the title with a bumped version, then
 * retires the previous one (via existing endpoints — no lineage is recorded).
 * The full supersession relationship is the planned Tier 3 `:supersede`
 * lifecycle feature.
 */
export function NewVersionUploader({ documentId, title, version }: NewVersionUploaderProps) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onFile(file: File) {
    setBusy(true);
    setError(null);
    try {
      const newId = await uploadOne(file, title);
      // Inherit the title with a bumped version on the new document…
      await fetch(`/api/documents/${newId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ version: bumpVersion(version) }),
      });
      // …then retire the previous version.
      await fetch(`/api/documents/${documentId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status: 'retired' }),
      });
      router.push(`/documents/${newId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not upload a new version.');
      setBusy(false);
    }
  }

  return (
    <div className="new-version">
      <button
        type="button"
        className="btn btn--secondary btn--sm"
        disabled={busy}
        onClick={() => inputRef.current?.click()}
      >
        {busy ? 'Uploading new version…' : 'Upload new version'}
      </button>
      <input
        ref={inputRef}
        className="visually-hidden"
        type="file"
        accept="application/pdf,.pdf"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) void onFile(file);
        }}
      />
      {error ? (
        <p role="alert" className="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
