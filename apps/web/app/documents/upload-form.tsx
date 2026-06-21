'use client';
// SPDX-License-Identifier: Apache-2.0
import { useCallback, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { IngestionBadge } from './ingestion-badge';

type ItemStatus = 'requesting' | 'uploading' | 'finalizing' | 'done' | 'error';

interface UploadItem {
  key: number;
  name: string;
  status: ItemStatus;
  documentId: string | null;
  error: string | null;
}

const STATUS_LABEL: Record<ItemStatus, string> = {
  requesting: 'Requesting…',
  uploading: 'Uploading…',
  finalizing: 'Finalizing…',
  done: 'Uploaded —',
  error: 'Failed',
};

async function readDetail(res: Response, fallback: string): Promise<string> {
  try {
    const body = await res.json();
    return typeof body?.detail === 'string' ? body.detail : fallback;
  } catch {
    return fallback;
  }
}

function isPdf(file: File): boolean {
  return file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
}

/**
 * Run a single file through the three-step upload (sign → PUT → finalize).
 * Reports each phase via `onPhase`; resolves with the created document id.
 */
async function uploadOne(file: File, onPhase: (status: ItemStatus) => void): Promise<string> {
  const contentType = file.type || 'application/pdf';

  onPhase('requesting');
  const uploadRes = await fetch('/api/documents/uploads', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ filename: file.name, size_bytes: file.size, content_type: contentType }),
  });
  if (!uploadRes.ok) throw new Error(await readDetail(uploadRes, 'Could not start the upload.'));
  const { upload_id, signed_url } = await uploadRes.json();

  onPhase('uploading');
  const putRes = await fetch(signed_url, {
    method: 'PUT',
    body: file,
    headers: { 'content-type': contentType },
  });
  if (!putRes.ok) throw new Error('Uploading the file to storage failed.');

  onPhase('finalizing');
  const finalizeRes = await fetch('/api/documents', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ upload_id, title: file.name.replace(/\.pdf$/i, '') }),
  });
  if (!finalizeRes.ok) throw new Error(await readDetail(finalizeRes, 'Could not finalize the document.'));
  const created = (await finalizeRes.json().catch(() => ({}))) as { id?: string };
  return created.id ?? '';
}

/**
 * Multi-file uploader. Accepts drag-and-drop or multi-select; each PDF is
 * uploaded straight to Storage via a signed URL (never through the API) and
 * tracked independently with a live ingestion badge. Non-PDFs are ignored.
 */
export function UploadForm() {
  const router = useRouter();
  const [items, setItems] = useState<UploadItem[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const nextKey = useRef(0);

  const busy = items.some((i) => i.status !== 'done' && i.status !== 'error');

  function update(key: number, patch: Partial<UploadItem>) {
    setItems((prev) => prev.map((i) => (i.key === key ? { ...i, ...patch } : i)));
  }

  const handleFiles = useCallback(
    async (fileList: FileList | File[]) => {
      const pdfs = Array.from(fileList).filter(isPdf);
      if (pdfs.length === 0) return;

      const queued = pdfs.map((file) => ({
        key: nextKey.current++,
        name: file.name,
        status: 'requesting' as ItemStatus,
        documentId: null,
        error: null,
      }));
      // Newest on top so a fresh batch is visible above older rows.
      setItems((prev) => [...queued.slice().reverse(), ...prev]);

      // Upload sequentially — keeps the signed-URL + Storage load gentle and
      // the UI legible. Each row updates independently as it progresses.
      for (let i = 0; i < pdfs.length; i++) {
        const item = queued[i]!;
        try {
          const id = await uploadOne(pdfs[i]!, (status) => update(item.key, { status }));
          update(item.key, { status: 'done', documentId: id });
        } catch (err) {
          update(item.key, {
            status: 'error',
            error: err instanceof Error ? err.message : 'Upload failed.',
          });
        }
      }
      router.refresh();
    },
    [router],
  );

  function onDrop(event: React.DragEvent) {
    event.preventDefault();
    setDragOver(false);
    if (event.dataTransfer?.files?.length) void handleFiles(event.dataTransfer.files);
  }

  return (
    <section className="card">
      <h2 className="card__title">Upload PDFs</h2>
      <div
        className={`dropzone${dragOver ? ' dropzone--over' : ''}`}
        data-testid="dropzone"
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
      >
        <p>
          <strong>Drag &amp; drop PDFs here</strong>, or click to choose files.
        </p>
        <p className="muted">You can select multiple files at once.</p>
        <input
          ref={inputRef}
          className="visually-hidden"
          type="file"
          accept="application/pdf,.pdf"
          multiple
          onChange={(e) => {
            if (e.target.files?.length) void handleFiles(e.target.files);
            e.target.value = ''; // allow re-selecting the same file(s)
          }}
        />
      </div>

      {items.length > 0 ? (
        <ul className="upload-list" data-testid="upload-list">
          {items.map((item) => (
            <li key={item.key} className="upload-list__item">
              <span className="upload-list__name">{item.name}</span>
              <span className="upload-list__status">
                {item.status === 'done' && item.documentId ? (
                  <>
                    {STATUS_LABEL.done}{' '}
                    <IngestionBadge documentId={item.documentId} initialState="pending" showError />
                  </>
                ) : item.status === 'error' ? (
                  <span role="alert" className="alert alert--inline">
                    {item.error ?? 'Upload failed.'}
                  </span>
                ) : (
                  <span className="muted">{STATUS_LABEL[item.status]}</span>
                )}
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {busy ? (
        <p role="status" className="visually-hidden">
          Uploading…
        </p>
      ) : null}
    </section>
  );
}
