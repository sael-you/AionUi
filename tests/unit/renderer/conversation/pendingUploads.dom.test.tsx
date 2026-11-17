/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const upload = vi.hoisted(() => ({ fn: vi.fn() }));
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
vi.mock('@/renderer/services/FileService', () => ({ uploadFileViaHttp: upload.fn }));

import PendingUploads from '@/renderer/pages/conversation/platforms/PendingUploads';
import {
  PENDING_UPLOAD_MAX_FILE_BYTES,
  PENDING_UPLOAD_MAX_TOTAL_BYTES,
  isUploadConnectionError,
  pendingUploadStore,
} from '@/renderer/services/pendingUploads/pendingUploadStore';

const file = (name: string, size = 4) => new File([new Uint8Array(size)], name, { type: 'image/png' });
/** A File that only claims a size, so the caps can be tested without big buffers. */
const sized = (name: string, size: number) => Object.defineProperty(file(name), 'size', { value: size });

describe('files attached without a connection (TASK-127)', () => {
  beforeEach(() => {
    pendingUploadStore.resetForTests();
    realtime.listeners.clear();
    upload.fn.mockReset();
  });

  it('keeps the bytes per conversation and gives the same file back', async () => {
    expect(await pendingUploadStore.save('c1', file('a.png', 7))).toBe('saved');
    expect(await pendingUploadStore.save('c2', file('b.png'))).toBe('saved');
    const [kept] = await pendingUploadStore.list('c1');
    expect(kept).toMatchObject({ name: 'a.png', size: 7, type: 'image/png', conversationId: 'c1' });
    expect(await pendingUploadStore.list('c1')).toHaveLength(1);

    const back = await pendingUploadStore.read(kept?.id as string);
    expect(back?.name).toBe('a.png');
    expect(back?.size).toBe(7);
    await pendingUploadStore.remove(kept?.id as string);
    expect(await pendingUploadStore.list('c1')).toEqual([]);
    expect(await pendingUploadStore.read(kept?.id as string)).toBeNull();
  });

  it('refuses a file over the per-file cap and stops at the total cap', async () => {
    expect(await pendingUploadStore.save('c1', sized('huge.bin', PENDING_UPLOAD_MAX_FILE_BYTES + 1))).toBe('too-large');
    const chunk = PENDING_UPLOAD_MAX_FILE_BYTES;
    const fits = Math.floor(PENDING_UPLOAD_MAX_TOTAL_BYTES / chunk);
    for (let index = 0; index < fits; index += 1) {
      expect(await pendingUploadStore.save('c1', sized(`f${index}`, chunk))).toBe('saved');
    }
    expect(await pendingUploadStore.save('c1', sized('one-more', chunk))).toBe('full');
  });

  it('only a missing answer counts as no connection', () => {
    expect(isUploadConnectionError(new Error('Upload failed: network error'))).toBe(true);
    expect(isUploadConnectionError(new Error('FILE_TOO_LARGE'))).toBe(false);
    expect(isUploadConnectionError(new Error('Upload failed: 500 Internal Server Error'))).toBe(false);
  });

  it('lists the waiting files and uploads them when the connection returns', async () => {
    await pendingUploadStore.save('c1', file('a.png'));
    await pendingUploadStore.save('c1', file('b.png'));
    upload.fn.mockResolvedValueOnce('/uploads/a.png').mockResolvedValueOnce('/uploads/b.png');
    const onUploaded = vi.fn();
    render(<PendingUploads conversation_id='c1' onUploaded={onUploaded} />);

    await waitFor(() => expect(screen.getAllByTestId('pending-upload')).toHaveLength(2));
    expect(screen.getByTestId('pending-uploads')).toHaveTextContent('conversation.pendingUpload.waiting');

    act(() => realtime.listeners.forEach((listener) => listener()));
    await waitFor(() => expect(onUploaded).toHaveBeenCalledTimes(2));
    expect(onUploaded.mock.calls.map((call) => call[0])).toEqual([['/uploads/a.png'], ['/uploads/b.png']]);
    await waitFor(() => expect(screen.queryByTestId('pending-uploads')).toBeNull());
    expect(await pendingUploadStore.list('c1')).toEqual([]);
  });

  it('keeps waiting when the upload fails again, and Retry tries once more', async () => {
    await pendingUploadStore.save('c1', file('a.png'));
    upload.fn.mockRejectedValueOnce(new Error('Upload failed: network error')).mockResolvedValueOnce('/uploads/a.png');
    const onUploaded = vi.fn();
    render(<PendingUploads conversation_id='c1' onUploaded={onUploaded} />);
    await screen.findByTestId('pending-upload');

    act(() => window.dispatchEvent(new Event('online')));
    await waitFor(() => expect(upload.fn).toHaveBeenCalledTimes(1));
    expect(onUploaded).not.toHaveBeenCalled();
    expect(screen.getByTestId('pending-upload')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'conversation.unsent.retry' }));
    await waitFor(() => expect(onUploaded).toHaveBeenCalledWith(['/uploads/a.png']));
  });

  it('removes a waiting file on request', async () => {
    await pendingUploadStore.save('c1', file('a.png'));
    const view = render(<PendingUploads conversation_id='c1' onUploaded={vi.fn()} />);
    const chip = await screen.findByTestId('pending-upload');
    fireEvent.click(chip.querySelector('.arco-tag-close-btn') as HTMLElement);
    await waitFor(() => expect(view.queryByTestId('pending-uploads')).toBeNull());
    expect(upload.fn).not.toHaveBeenCalled();
  });
});
