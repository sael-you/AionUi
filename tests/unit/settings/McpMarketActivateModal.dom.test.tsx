/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * Activating a production write MCP needs the owner's approval reference
 * (OA-<yyyymmdd>-<slug>): a required field that never defaults.
 */

import React from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { McpMarketInstance } from '@/common/config/storage';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

import ActivateModal from '@/renderer/pages/settings/ToolsSettings/market/ActivateModal';

const instance = (extra: Partial<McpMarketInstance> = {}): McpMarketInstance => ({
  id: 'i1',
  name: 'tb-paddle-prod-write',
  template_id: 'paddle',
  transport: 'stdio',
  environment: 'production',
  tier: 'write',
  enforcement: 'server',
  status: 'dormant',
  clis: ['claude'],
  plain_env: {},
  secrets: [],
  missing: [],
  tools_block: [],
  tools_seen: [],
  last_test_status: 'unknown',
  template_in_catalogue: true,
  template_update_available: false,
  created_at: 1,
  updated_at: 1,
  ...extra,
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

const okButton = () => screen.getByText('mcp.market.actions.activate').closest('button') as HTMLButtonElement;
const approvalInput = () => document.getElementById('mcp-market-approval-ref') as HTMLInputElement | null;

describe('ActivateModal', () => {
  it('shows a required, empty approval field with the owner-approval help for production write', () => {
    // Even with a recorded approval on the row, the field starts empty.
    render(
      <ActivateModal instance={instance({ approval_ref: 'OA-20261101-old' })} onCancel={vi.fn()} onConfirm={vi.fn()} />
    );
    const input = approvalInput();
    expect(input).not.toBeNull();
    expect(input!.value).toBe('');
    expect(input!.getAttribute('aria-required')).toBe('true');
    expect(screen.getByText(/mcp\.market\.activate\.approvalHelp/)).toBeInTheDocument();
    expect(okButton()).toBeDisabled();
  });

  it('keeps Activate disabled for a malformed reference and sends a valid one', async () => {
    const onConfirm = vi.fn(() => Promise.resolve());
    render(<ActivateModal instance={instance()} onCancel={vi.fn()} onConfirm={onConfirm} />);

    fireEvent.change(approvalInput()!, { target: { value: 'approved' } });
    fireEvent.blur(approvalInput()!);
    expect(okButton()).toBeDisabled();
    expect(screen.getByText('mcp.market.activate.approvalInvalid')).toBeInTheDocument();

    fireEvent.change(approvalInput()!, { target: { value: 'OA-20261115-paddle-prod-write' } });
    expect(okButton()).not.toBeDisabled();
    fireEvent.click(okButton());
    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith('OA-20261115-paddle-prod-write'));
  });

  it('asks no approval for a non-production write or a read instance', async () => {
    const onConfirm = vi.fn(() => Promise.resolve());
    render(<ActivateModal instance={instance({ environment: 'sandbox' })} onCancel={vi.fn()} onConfirm={onConfirm} />);
    expect(approvalInput()).toBeNull();
    fireEvent.click(okButton());
    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith(undefined));
  });

  it('blocks activation while required values are missing', () => {
    render(
      <ActivateModal
        instance={instance({ environment: 'staging', missing: ['PADDLE_API_KEY'] })}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />
    );
    expect(screen.getByText('mcp.market.activate.missing')).toBeInTheDocument();
    expect(okButton()).toBeDisabled();
  });

  it('shows the server refusal', async () => {
    const onConfirm = vi.fn(() => Promise.reject(new Error('refused by rule R3')));
    render(<ActivateModal instance={instance({ environment: 'local' })} onCancel={vi.fn()} onConfirm={onConfirm} />);
    fireEvent.click(okButton());
    await waitFor(() => expect(screen.getByText('refused by rule R3')).toBeInTheDocument());
  });
});
