/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * D50: activating a production write MCP is not gated on an approval
 * reference; the modal states that the agent asks before every call (TASK-97).
 */

import React from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { McpMarketInstance } from '@/common/config/storage';
import i18nConfig from '@/common/config/i18n-config.json';
import enMcp from '@/renderer/services/i18n/locales/en-US/mcp.json';

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
const approvalInput = () => document.getElementById('mcp-market-approval-ref');

describe('ActivateModal', () => {
  it('activates a production write MCP without an approval field and states the rule', async () => {
    const onConfirm = vi.fn(() => Promise.resolve());
    render(<ActivateModal instance={instance()} onCancel={vi.fn()} onConfirm={onConfirm} />);
    expect(approvalInput()).toBeNull();
    expect(screen.getByText('mcp.market.activate.productionWrite')).toBeInTheDocument();
    expect(okButton()).not.toBeDisabled();
    fireEvent.click(okButton());
    await waitFor(() => expect(onConfirm).toHaveBeenCalled());
  });

  it('says a production write asks before every call, in every copy and locale (TASK-97)', async () => {
    const { activate, create, instance: drawer } = enMcp.market;
    for (const text of [activate.productionWrite, create.fullToolsNote, drawer.writeNote]) {
      expect(text).toContain('the agent asks you before every call to this server, on every CLI');
      expect(text).not.toMatch(/automatic confirmation/i);
    }
    for (const lang of i18nConfig.supportedLanguages) {
      const { market } = (await import(`@/renderer/services/i18n/locales/${lang}/mcp.json`)).default as typeof enMcp;
      for (const text of [market.create.fullToolsNote, market.instance.writeNote]) {
        expect(text, lang).toContain(market.activate.productionWrite);
      }
      // The new sentence names the CLIs it applies to; the old "no automatic confirmation" one did not.
      expect(market.activate.productionWrite, lang).toContain('CLI');
    }
  });

  it('shows no production rule for a non-production write or a read instance', () => {
    render(<ActivateModal instance={instance({ environment: 'sandbox' })} onCancel={vi.fn()} onConfirm={vi.fn()} />);
    expect(screen.queryByText('mcp.market.activate.productionWrite')).toBeNull();
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
