/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Train-2 review U1 #3: create and set-secret are separate requests. When the
 * instance is created but a secret is not saved, the modal must treat the
 * create as done (onCreated → the drawer opens on it) and say which secrets
 * to set there, instead of an error whose retry only hits "name taken".
 */

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { McpMarketInstance, McpMarketTemplate } from '@/common/config/storage';

const spies = vi.hoisted(() => ({ warning: vi.fn() }));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options && 'keys' in options ? `${key}|${String(options.name)}|${String(options.keys)}` : key,
  }),
}));

// Arco's Select is a portal popup; a native select keeps the test about the
// create flow. Message is spied on.
vi.mock('@arco-design/web-react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@arco-design/web-react')>();
  const Select = ({
    value,
    onChange,
    children,
  }: {
    value?: string;
    onChange: (v: string) => void;
    children?: React.ReactNode;
  }) => (
    <select data-testid='env-select' value={value ?? ''} onChange={(e) => onChange(e.target.value)}>
      <option value='' />
      {children}
    </select>
  );
  const Option = ({ value, children }: { value: string; children?: React.ReactNode }) => (
    <option value={value}>{children}</option>
  );
  return {
    ...actual,
    Select: Object.assign(Select, { Option }),
    Message: { ...actual.Message, warning: spies.warning },
  };
});

import CreateInstanceModal from '@/renderer/pages/settings/ToolsSettings/market/CreateInstanceModal';
import { McpMarketSecretsNotSavedError } from '@/renderer/hooks/mcp/market/marketModel';

const template: McpMarketTemplate = {
  id: 'paddle',
  name: 'Paddle',
  transport: 'stdio',
  env: {},
  tiers: ['read'],
  enforcement: 'server',
  clis: ['claude'],
};

const created = { id: 'new-1', name: 'tb-paddle' } as McpMarketInstance;

describe('CreateInstanceModal when a secret is not saved', () => {
  beforeEach(() => {
    spies.warning.mockReset();
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

  it('reports the instance as created and names the missing secrets', async () => {
    const market = {
      createInstance: vi.fn(() => Promise.reject(new McpMarketSecretsNotSavedError(created, ['PADDLE_API_KEY']))),
      duplicateInstance: vi.fn(),
    };
    const onCreated = vi.fn();
    render(
      <CreateInstanceModal
        target={{ kind: 'template', template }}
        takenNames={[]}
        market={market}
        onClose={vi.fn()}
        onCreated={onCreated}
      />
    );
    fireEvent.change(document.getElementById('mcp-market-name')!, { target: { value: 'tb-paddle' } });
    fireEvent.change(screen.getByTestId('env-select'), { target: { value: 'sandbox' } });
    fireEvent.click(screen.getByText('mcp.market.actions.create').closest('button')!);

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(created));
    expect(market.createInstance).toHaveBeenCalledTimes(1);
    expect(spies.warning).toHaveBeenCalledTimes(1);
    expect(spies.warning.mock.calls[0][0].content).toBe('mcp.market.create.secretsNotSaved|tb-paddle|PADDLE_API_KEY');
    // No inline error (a retry would only hit "name taken").
    expect(screen.queryByText('mcp.market.create.nameProblem.taken')).toBeNull();
  });
});
