'use client';
// SPDX-License-Identifier: Apache-2.0
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { IngestionBadge } from './ingestion-badge';

type Phase = 'idle' | 'requesting' | 'uploading' | 'finalizing' | 'done' | 'error';

const PHASE_COPY: Record<Phase, string> = {
  idle: 'Upload',
  requesting: 'Requesting…',
  uploading: 'Uploading…',
  finalizing: 'Finalizing…',
  done: 'Upload',
  error: 'Upload',
};

async function readDetail(res: Response, fallback: string): Promise<string> {
  try {
    const body = await res.json();
    return typeof body?.detail === 'string' ? body.detail : fallback;
  } catch {
    return fallback;
  }
}

export function UploadForm() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [uploadedId, setUploadedId] = useState<string | null>(null);

  const busy = phase === 'requesting' || phase === 'uploading' || phase === 'finalizing';

  function onFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0] ?? null;
    setFile(selected);
    if (selected && !title) setTitle(selected.name.replace(/\.pdf$/i, ''));
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file) return;
    // Capture the form element now: React nulls `event.currentTarget` once the
    // handler yields at the first `await`, so reading it later threw
    // "Cannot read properties of null (reading 'reset')".
    const form = event.currentTarget;
    setError(null);
    const contentType = file.type || 'application/pdf';

    try {
      // 1. Ask the API for a signed upload URL.
      setPhase('requesting');
      const uploadRes = await fetch('/api/documents/uploads', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ filename: file.name, size_bytes: file.size, content_type: contentType }),
      });
      if (!uploadRes.ok) throw new Error(await readDetail(uploadRes, 'Could not start the upload.'));
      const { upload_id, signed_url } = await uploadRes.json();

      // 2. Upload the bytes straight to Storage (never through the API).
      setPhase('uploading');
      const putRes = await fetch(signed_url, {
        method: 'PUT',
        body: file,
        headers: { 'content-type': contentType },
      });
      if (!putRes.ok) throw new Error('Uploading the file to storage failed.');

      // 3. Finalize: create the document record.
      setPhase('finalizing');
      const finalizeRes = await fetch('/api/documents', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ upload_id, title: title.trim() || file.name }),
      });
      if (!finalizeRes.ok) throw new Error(await readDetail(finalizeRes, 'Could not finalize the document.'));
      const created = (await finalizeRes.json().catch(() => ({}))) as { id?: string };

      setUploadedId(created.id ?? null);
      setPhase('done');
      setFile(null);
      setTitle('');
      form.reset();
      router.refresh();
    } catch (err) {
      setPhase('error');
      setError(err instanceof Error ? err.message : 'Upload failed.');
    }
  }

  return (
    <section className="card">
      <h2 className="card__title">Upload a PDF</h2>
      <form onSubmit={onSubmit}>
        <label className="field">
          <span className="field__label">File</span>
          <input
            className="input"
            type="file"
            accept="application/pdf,.pdf"
            onChange={onFileChange}
            required
          />
        </label>
        <label className="field">
          <span className="field__label">Title</span>
          <input
            className="input"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Document title"
          />
        </label>
        <div className="form-actions">
          <button type="submit" className="btn" disabled={!file || busy}>
            {PHASE_COPY[phase]}
          </button>
          {phase === 'done' ? (
            <span role="status" className="form-status form-status--success">
              Uploaded —{' '}
              {uploadedId ? (
                <IngestionBadge documentId={uploadedId} initialState="pending" showError />
              ) : (
                'processing will begin shortly.'
              )}
            </span>
          ) : null}
        </div>
      </form>
      {error ? (
        <p role="alert" className="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
