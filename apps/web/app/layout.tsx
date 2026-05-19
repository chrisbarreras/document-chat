// SPDX-License-Identifier: Apache-2.0
import type { ReactNode } from 'react';
import './globals.css';

export const metadata = {
  title: 'document-chat',
  description: 'Public Apache 2.0 starter for a document Q&A system.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
