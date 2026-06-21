// SPDX-License-Identifier: Apache-2.0
import Link from 'next/link';
import { getOptionalUser } from '../lib/auth';
import { getCurrentWorkspace } from '../lib/workspace';
import { listDocuments } from '../lib/documents-store';
import { listChats } from '../lib/chats-store';
import { AppShell } from './app-shell';

export const dynamic = 'force-dynamic';

const GITHUB_URL = 'https://github.com/chrisbarreras/document-chat';

export default async function Home() {
  const user = await getOptionalUser();

  if (!user) {
    return (
      <AppShell user={null}>
        <Landing />
      </AppShell>
    );
  }

  const workspace = await getCurrentWorkspace();
  const [docs, chats] = await Promise.all([
    listDocuments({ sort: 'uploaded_at', ascending: false, limit: 5 }),
    workspace
      ? listChats({ workspaceId: workspace.id, limit: 5 })
      : Promise.resolve({ items: [], nextCursor: null }),
  ]);

  return (
    <AppShell user={user}>
      <Dashboard documents={docs.items} chats={chats.items} />
    </AppShell>
  );
}

/* ------------------------------------------------------------------ */
/* Signed-out marketing landing                                        */
/* ------------------------------------------------------------------ */

function Landing() {
  return (
    <>
      <section className="hero">
        <span className="hero__eyebrow">Open-source · Apache 2.0 starter</span>
        <h1 className="hero__title">Chat with your documents — every answer cited.</h1>
        <p className="hero__lead">
          Upload PDFs (scans included), ask questions, and get streamed,
          Markdown-formatted answers that link back to the exact source chunk.
        </p>
        <div className="row hero__actions">
          <Link href="/signup" className="btn">
            Create account
          </Link>
          <Link href="/login" className="btn btn--secondary">
            Sign in
          </Link>
          <a href={GITHUB_URL} className="btn btn--ghost" target="_blank" rel="noopener noreferrer">
            View source
          </a>
        </div>
      </section>

      <section className="page-section">
        <h2 className="section-heading">How it works</h2>
        <ol className="steps">
          <li className="steps__item">
            <span className="steps__num">1</span>
            <h3>Upload</h3>
            <p>
              Drag in PDFs (or pick several at once). Scanned, image-only pages are OCR&apos;d
              automatically.
            </p>
          </li>
          <li className="steps__item">
            <span className="steps__num">2</span>
            <h3>Processed</h3>
            <p>
              A durable pipeline extracts, chunks, and embeds each document — with live status you
              can watch.
            </p>
          </li>
          <li className="steps__item">
            <span className="steps__num">3</span>
            <h3>Ask</h3>
            <p>Chat with streamed answers whose citation chips point back to the exact source.</p>
          </li>
        </ol>
      </section>

      <section className="page-section">
        <h2 className="section-heading">What you get</h2>
        <div className="card-grid">
          <FeatureCard title="Traceable citations">
            Every claim links to the chunk it came from — open the source in a side drawer.
          </FeatureCard>
          <FeatureCard title="OCR for scans">
            Image-only PDFs are transcribed automatically (Mistral OCR by default), so photocopies
            are searchable too.
          </FeatureCard>
          <FeatureCard title="Conversation memory">
            Follow-up questions keep the context of everything asked and answered so far.
          </FeatureCard>
          <FeatureCard title="Document lifecycle">
            Versions, full ingestion history, reprocessing, and one-click download of the original.
          </FeatureCard>
        </div>
      </section>
    </>
  );
}

function FeatureCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card">
      <h3 className="card__title">{title}</h3>
      <p className="card__subtitle">{children}</p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Signed-in dashboard                                                 */
/* ------------------------------------------------------------------ */

interface DocItem {
  id: string;
  title: string;
  ingestion_state: string;
  created_at: string;
}
interface ChatItem {
  id: string;
  title: string;
  last_message_at: string | null;
  created_at: string;
}

function Dashboard({ documents, chats }: { documents: DocItem[]; chats: ChatItem[] }) {
  const lastChat = chats[0];
  return (
    <>
      <div className="page-header">
        <div className="page-header__title">
          <h1>Welcome back</h1>
          <p>Pick up where you left off, or add something new.</p>
        </div>
        <div className="page-header__actions">
          <Link href="/documents" className="btn btn--secondary">
            Upload a PDF
          </Link>
          {lastChat ? (
            <Link href={`/chats/${lastChat.id}`} className="btn">
              Continue last chat
            </Link>
          ) : (
            <Link href="/chats" className="btn">
              Start a chat
            </Link>
          )}
        </div>
      </div>

      <div className="card-grid card-grid--two">
        <section className="card">
          <div className="row row--space-between">
            <h2 className="card__title" style={{ margin: 0 }}>
              Recent documents
            </h2>
            <Link href="/documents" className="subtle">
              View all →
            </Link>
          </div>
          {documents.length === 0 ? (
            <p className="card__subtitle">No documents yet. Upload a PDF to get started.</p>
          ) : (
            <ul className="recent-list">
              {documents.map((doc) => (
                <li key={doc.id} className="recent-list__item">
                  <Link href={`/documents/${doc.id}`} className="recent-list__title">
                    {doc.title}
                  </Link>
                  <span className={`badge badge--${doc.ingestion_state}`}>{doc.ingestion_state}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card">
          <div className="row row--space-between">
            <h2 className="card__title" style={{ margin: 0 }}>
              Recent chats
            </h2>
            <Link href="/chats" className="subtle">
              View all →
            </Link>
          </div>
          {chats.length === 0 ? (
            <p className="card__subtitle">No chats yet. Ask a question to get started.</p>
          ) : (
            <ul className="recent-list">
              {chats.map((chat) => (
                <li key={chat.id} className="recent-list__item">
                  <Link href={`/chats/${chat.id}`} className="recent-list__title">
                    {chat.title}
                  </Link>
                  <span className="subtle">
                    {new Date(chat.last_message_at ?? chat.created_at).toLocaleDateString()}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}
