/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * The MCP market secret field is write-only: a stored secret shows as
 * Set / Not set, a typed value is sent once and never rendered again.
 */

import React from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { McpMarketSecretStatus } from '@/common/config/storage';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

import SecretField from '@/renderer/pages/settings/ToolsSettings/market/SecretField';

const SENTINEL = 'FAKE-SECRET-SENTINEL-0001';

const status = (set: boolean): McpMarketSecretStatus => ({
  key: 'PADDLE_API_KEY',
  name: 'TB_PADDLE_PROD_READ__PADDLE_API_KEY',
  instance_id: 'i1',
  instance_name: 'tb-paddle-prod-read',
  required: true,
  set,
  updated_at: set ? 1_700_000_000_000 : undefined,
});

beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
});

afterEach(() => cleanup());

const inputs = (container: HTMLElement) => Array.from(container.querySelectorAll('input'));

describe('SecretField (edit mode)', () => {
  it('shows a stored secret as "set" with no input and no value', () => {
    const { container } = render(
      <SecretField
        mode='edit'
        secretKey='PADDLE_API_KEY'
        required
        status={status(true)}
        onReplace={vi.fn()}
        onClear={vi.fn()}
      />
    );
    expect(screen.getByTestId('mcp-secret-state')).toHaveTextContent('mcp.market.secret.set');
    expect(inputs(container)).toHaveLength(0);
    expect(screen.getByText('mcp.market.secret.replace')).toBeInTheDocument();
    expect(screen.getByText('mcp.market.secret.clear')).toBeInTheDocument();
  });

  it('shows "not set" and offers Set value, no Clear', () => {
    render(
      <SecretField
        mode='edit'
        secretKey='PADDLE_API_KEY'
        required
        status={status(false)}
        onReplace={vi.fn()}
        onClear={vi.fn()}
      />
    );
    expect(screen.getByTestId('mcp-secret-state')).toHaveTextContent('mcp.market.secret.notSet');
    expect(screen.getByText('mcp.market.secret.setValue')).toBeInTheDocument();
    expect(screen.queryByText('mcp.market.secret.clear')).toBeNull();
  });

  it('Replace opens an empty password input, sends the value once and never renders it afterwards', async () => {
    const onReplace = vi.fn(() => Promise.resolve());
    const { container } = render(
      <SecretField
        mode='edit'
        secretKey='PADDLE_API_KEY'
        required
        status={status(true)}
        onReplace={onReplace}
        onClear={vi.fn()}
      />
    );
    fireEvent.click(screen.getByText('mcp.market.secret.replace'));
    const [input] = inputs(container);
    expect(input).toBeDefined();
    expect(input.type).toBe('password');
    expect(input.value).toBe('');
    expect(input.getAttribute('autocomplete')).toBe('new-password');

    fireEvent.change(input, { target: { value: SENTINEL } });
    fireEvent.click(screen.getByText('mcp.market.actions.save'));

    await waitFor(() => expect(onReplace).toHaveBeenCalledWith(SENTINEL));
    await waitFor(() => expect(inputs(container)).toHaveLength(0));
    expect(container.innerHTML).not.toContain(SENTINEL);
  });

  it('drops the typed value from the form even when the save fails', async () => {
    const onReplace = vi.fn(() => Promise.reject(new Error('boom')));
    const { container } = render(
      <SecretField
        mode='edit'
        secretKey='PADDLE_API_KEY'
        required
        status={status(false)}
        onReplace={onReplace}
        onClear={vi.fn()}
      />
    );
    fireEvent.click(screen.getByText('mcp.market.secret.setValue'));
    fireEvent.change(inputs(container)[0], { target: { value: SENTINEL } });
    fireEvent.click(screen.getByText('mcp.market.actions.save'));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('boom'));
    expect(inputs(container)[0].value).toBe('');
    expect(container.innerHTML).not.toContain(SENTINEL);
  });

  it('refuses a pasted masked value without sending it', async () => {
    const onReplace = vi.fn(() => Promise.resolve());
    const { container } = render(
      <SecretField
        mode='edit'
        secretKey='PADDLE_API_KEY'
        required
        status={status(true)}
        onReplace={onReplace}
        onClear={vi.fn()}
      />
    );
    fireEvent.click(screen.getByText('mcp.market.secret.replace'));
    fireEvent.change(inputs(container)[0], { target: { value: '•••' } });
    fireEvent.click(screen.getByText('mcp.market.actions.save'));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('mcp.market.errors.maskedValue'));
    expect(onReplace).not.toHaveBeenCalled();
  });
});

describe('SecretField (create mode)', () => {
  it('starts empty and is a password input', () => {
    const { container } = render(
      <SecretField mode='create' secretKey='PADDLE_API_KEY' required value='' onChange={vi.fn()} />
    );
    const [input] = inputs(container);
    expect(input.type).toBe('password');
    expect(input.value).toBe('');
  });
});
