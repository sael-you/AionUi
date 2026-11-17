/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { SWRConfig } from 'swr';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const realtime = vi.hoisted(() => ({ listeners: new Set<() => void>() }));

vi.mock('@/common', () => ({
  ipcBridge: {
    realtime: {
      reconnected: {
        on: (listener: () => void) => {
          realtime.listeners.add(listener);
          return () => realtime.listeners.delete(listener);
        },
      },
    },
  },
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

import { resetOfflineOwnerForTests } from '@/renderer/services/pendingUploads/offlineOwner';
import { BackendHttpError } from '@/common/adapter/httpBridge';
import UnsentMessageBanner from '@/renderer/pages/conversation/platforms/UnsentMessageBanner';
import { isConnectionFailure, useUnsentMessage } from '@/renderer/pages/conversation/platforms/useUnsentMessage';

const KEY = 'aionui.unsentMessage.u1.c1';
const MESSAGE = { input: '> quote\n\nhello', files: [], draftText: 'hello' };

const mount = (options: { idempotent: boolean; resend?: () => Promise<void>; content?: string; keyed?: boolean }) => {
  const resend = options.resend ?? vi.fn().mockResolvedValue(undefined);
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <SWRConfig
      value={{
        provider: () => new Map(),
        fallback: { 'conversation/c1': { id: 'c1', capabilities: { send_idempotency: options.idempotent } } },
      }}
    >
      {children}
    </SWRConfig>
  );
  const view = renderHook(
    ({ content }: { content: string }) =>
      useUnsentMessage({ conversation_id: 'c1', content, resend, keyed: options.keyed }),
    { wrapper, initialProps: { content: options.content ?? '' } }
  );
  return { ...view, resend };
};

describe('unsent message recovery (TASK-127)', () => {
  beforeEach(() => {
    resetOfflineOwnerForTests('u1');
    window.localStorage.clear();
    realtime.listeners.clear();
  });

  it('treats a missing answer as no connection, a real refusal as an error', () => {
    const http = (status: number) => new BackendHttpError({ method: 'POST', path: '/x', status, body: {} });
    expect(isConnectionFailure(new TypeError('Failed to fetch'))).toBe(true);
    expect(isConnectionFailure(http(502))).toBe(true);
    expect(isConnectionFailure(http(503))).toBe(true);
    expect(isConnectionFailure(http(409))).toBe(false);
    expect(isConnectionFailure(http(500))).toBe(false);
    expect(isConnectionFailure(new Error('boom'))).toBe(false);
  });

  it('remembers the message across a reload and reuses its key for the same message only', () => {
    const first = mount({ idempotent: true });
    const key = first.result.current.keyFor(MESSAGE.input, []) as string;
    expect(key.length).toBeGreaterThan(0);
    expect(key.length).toBeLessThanOrEqual(128);
    act(() => first.result.current.remember({ ...MESSAGE, key }));
    expect(JSON.parse(window.localStorage.getItem(KEY) as string)).toMatchObject({ key, input: MESSAGE.input });
    first.unmount();

    const second = mount({ idempotent: true, content: 'hello' });
    expect(second.result.current.unsent?.key).toBe(key);
    expect(second.result.current.keyFor(MESSAGE.input, [])).toBe(key);
    expect(second.result.current.keyFor('something else', [])).not.toBe(key);
  });

  it('sends no key to a core without the capability, and does not retry by itself', async () => {
    const view = mount({ idempotent: false });
    expect(view.result.current.keyFor(MESSAGE.input, [])).toBeUndefined();
    act(() => view.result.current.remember(MESSAGE));
    act(() => {
      window.dispatchEvent(new Event('online'));
      realtime.listeners.forEach((listener) => listener());
    });
    expect(view.resend).not.toHaveBeenCalled();

    await act(() => view.result.current.retry());
    expect(view.resend).toHaveBeenCalledTimes(1);
    expect(view.result.current.unsent).toBeNull();
  });

  it('team sends take no key: no key and no automatic retry even on a capable core', () => {
    const view = mount({ idempotent: true, keyed: false });
    expect(view.result.current.idempotent).toBe(false);
    expect(view.result.current.keyFor(MESSAGE.input, [])).toBeUndefined();
    act(() => view.result.current.remember(MESSAGE));
    act(() => window.dispatchEvent(new Event('online')));
    expect(view.resend).not.toHaveBeenCalled();
  });

  it('retries with the same key when the connection returns, once, and forgets it on success', async () => {
    let finish: () => void = () => {};
    const resend = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    const view = mount({ idempotent: true, resend });
    act(() => view.result.current.remember({ ...MESSAGE, key: 'k-1' }));

    act(() => {
      window.dispatchEvent(new Event('online'));
      realtime.listeners.forEach((listener) => listener());
    });
    expect(resend).toHaveBeenCalledTimes(1);
    expect(resend).toHaveBeenCalledWith(expect.objectContaining({ key: 'k-1', input: MESSAGE.input }));
    expect(view.result.current.retrying).toBe(true);

    await act(async () => finish());
    expect(view.result.current.unsent).toBeNull();
    expect(window.localStorage.getItem(KEY)).toBeNull();
  });

  it('keeps the record when the retry fails again', async () => {
    const view = mount({ idempotent: true, resend: vi.fn().mockRejectedValue(new TypeError('Failed to fetch')) });
    act(() => view.result.current.remember({ ...MESSAGE, key: 'k-1' }));
    await act(() => view.result.current.retry());
    expect(view.result.current.unsent?.key).toBe('k-1');
    expect(view.result.current.retrying).toBe(false);
  });

  it('an edit of the restored text makes it an ordinary draft again (new message, new key)', async () => {
    const view = mount({ idempotent: true });
    act(() => view.result.current.remember({ ...MESSAGE, key: 'k-1' }));
    // The composer is briefly empty before the text is put back: not an edit.
    expect(view.result.current.unsent?.key).toBe('k-1');
    view.rerender({ content: 'hello' });
    expect(view.result.current.unsent?.key).toBe('k-1');
    view.rerender({ content: 'hello there' });
    await waitFor(() => expect(view.result.current.unsent).toBeNull());
    expect(view.result.current.keyFor(MESSAGE.input, [])).not.toBe('k-1');
  });

  it('shows Not sent with Retry, and says when it retries by itself', () => {
    const onRetry = vi.fn();
    const view = render(<UnsentMessageBanner retrying={false} autoRetry onRetry={onRetry} />);
    expect(screen.getByTestId('unsent-message-banner')).toHaveTextContent('conversation.unsent.notSent');
    expect(screen.getByTestId('unsent-message-banner')).toHaveTextContent('conversation.unsent.autoRetry');
    fireEvent.click(screen.getByRole('button', { name: 'conversation.unsent.retry' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    view.rerender(<UnsentMessageBanner retrying={false} autoRetry={false} onRetry={onRetry} />);
    expect(screen.getByTestId('unsent-message-banner')).not.toHaveTextContent('conversation.unsent.autoRetry');
  });
});
