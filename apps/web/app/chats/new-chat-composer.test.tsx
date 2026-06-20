// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';

const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

import { NewChatComposer } from './new-chat-composer';

function createChatFetch(id = 'chat-1') {
  return vi.fn(async () => new Response(JSON.stringify({ id }), { status: 201 }));
}

function start(question: string): ReturnType<typeof vi.fn> {
  const fetchMock = createChatFetch();
  vi.stubGlobal('fetch', fetchMock);
  render(<NewChatComposer />);
  fireEvent.change(screen.getByRole('textbox'), { target: { value: question } });
  fireEvent.click(screen.getByRole('button', { name: /start chat/i }));
  return fetchMock;
}

beforeEach(() => push.mockReset());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('NewChatComposer', () => {
  it('creates the chat with a title only — no first_message (avoids a duplicate user message)', async () => {
    // Regression: persisting first_message here *and* via the chat page's
    // auto-send produced two user rows. The composer must send title only.
    const fetchMock = start('Who is Tom Barreras?');
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.title).toBe('Who is Tom Barreras?');
    expect(body.first_message).toBeUndefined();
    await waitFor(() =>
      expect(push).toHaveBeenCalledWith('/chats/chat-1?q=Who%20is%20Tom%20Barreras%3F'),
    );
  });

  it('truncates long titles to match the server defaultChatTitle', async () => {
    const fetchMock = start('x'.repeat(100));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.title).toBe(`${'x'.repeat(57)}…`);
  });
});
