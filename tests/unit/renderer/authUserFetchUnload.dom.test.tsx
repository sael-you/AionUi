/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The current-user check: a request cancelled because the page is unloading
 * (reload / navigation — the browser reports it as `TypeError: Failed to fetch`)
 * is not an error to log; a real network failure still is.
 */

import { cleanup, render, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The DOM test setup defines window.electronAPI (desktop runtime, which skips the
// check); the WebUI path is what is under test, so drop it before the module loads.
vi.hoisted(() => {
  delete (window as { electronAPI?: unknown }).electronAPI;
});

import { AuthProvider, useAuth } from '@/renderer/hooks/context/AuthContext';

const Status: React.FC = () => <span data-testid='status'>{useAuth().status}</span>;

let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.reject(new TypeError('Failed to fetch')))
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.dispatchEvent(new Event('pageshow'));
});

const logged = () => consoleError.mock.calls.some((call) => String(call[0]).includes('Failed to fetch current user'));

describe('current user check', () => {
  it('logs a real network failure', async () => {
    const { getByTestId } = render(
      <AuthProvider>
        <Status />
      </AuthProvider>
    );
    await waitFor(() => expect(getByTestId('status')).toHaveTextContent('unauthenticated'));
    expect(logged()).toBe(true);
  });

  it('stays silent when the request was cancelled by the page unloading', async () => {
    window.dispatchEvent(new Event('pagehide'));
    const { getByTestId } = render(
      <AuthProvider>
        <Status />
      </AuthProvider>
    );
    await waitFor(() => expect(getByTestId('status')).toHaveTextContent('unauthenticated'));
    expect(logged()).toBe(false);
  });
});
