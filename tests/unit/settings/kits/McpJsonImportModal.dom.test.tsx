/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { KitImportPreviewResponse } from '@/common/config/storage';
import { INSTANCES, fakeT, renderWithSwr } from './kitFixtures';

const api = vi.hoisted(() => {
  const fn = () => ({ invoke: vi.fn() });
  return {
    kits: { list: fn(), importPreview: fn(), importKeys: fn() },
    market: { listInstances: fn(), listTemplates: fn() },
    testMcpConnection: fn(),
    listSkills: fn(),
  };
});

vi.mock('@/common/adapter/ipcBridge', () => ({
  kits: api.kits,
  mcpService: { market: api.market, testMcpConnection: api.testMcpConnection },
}));
vi.mock('@/common', () => ({ ipcBridge: { fs: { listAvailableSkills: api.listSkills } } }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: fakeT }) }));
vi.mock('@/renderer/hooks/context/LayoutContext', () => ({ useLayoutContext: () => ({ isMobile: false }) }));

import McpJsonImportModal from '@/renderer/pages/settings/ToolsSettings/kits/McpJsonImportModal';

const PREVIEW: KitImportPreviewResponse = {
  project_id: 'proj-tb',
  file_found: true,
  servers: [
    {
      name: 'paddle',
      template_id: 'paddle',
      match: 'catalogue',
      secrets: [{ field: 'PADDLE_API_KEY', found: true }],
      oauth_only: false,
    },
    {
      name: 'supabase',
      template_id: 'supabase',
      match: 'catalogue',
      secrets: [
        { field: 'SUPABASE_ACCESS_TOKEN', found: true },
        { field: 'SUPABASE_DB_PASSWORD', found: false },
      ],
      oauth_only: false,
    },
    { name: 'tb-protocol', template_id: null, match: 'custom', secrets: [], oauth_only: false },
    { name: 'tavily', template_id: null, match: 'none', secrets: [], oauth_only: false },
  ],
};

const renderModal = () =>
  renderWithSwr(<McpJsonImportModal projectId='proj-tb' projectName='TB-test' visible onClose={vi.fn()} />);

describe('Import keys from .mcp.json (C28 §5)', () => {
  beforeEach(() => {
    api.kits.importPreview.invoke.mockResolvedValue(PREVIEW);
    api.kits.list.invoke.mockResolvedValue([]);
    api.market.listInstances.invoke.mockResolvedValue(INSTANCES);
    api.market.listTemplates.invoke.mockResolvedValue([]);
    api.listSkills.invoke.mockResolvedValue([]);
    api.kits.importKeys.invoke.mockResolvedValue({
      kit_id: 'kit-tb',
      servers: [
        { name: 'paddle', instance_id: 'inst-pdl', error_code: null, missing_secrets: [] },
        {
          name: 'supabase',
          instance_id: 'inst-sb2',
          error_code: null,
          missing_secrets: ['SUPABASE_DB_PASSWORD'],
        },
      ],
    });
    api.testMcpConnection.invoke.mockResolvedValue({ success: true, tools: [{ name: 'a' }, { name: 'b' }] });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('lists every server with its template and which keys were found, without any value', async () => {
    renderModal();

    const rows = await screen.findAllByTestId('kit-import-row');
    expect(api.kits.importPreview.invoke).toHaveBeenCalledWith({ project_id: 'proj-tb' });
    expect(rows).toHaveLength(4);
    expect(rows[1]).toHaveTextContent('mcp.kits.import.keyFound|{"field":"SUPABASE_ACCESS_TOKEN"}');
    expect(rows[1]).toHaveTextContent('mcp.kits.import.keyMissing|{"field":"SUPABASE_DB_PASSWORD"}');
    expect(rows[2]).toHaveTextContent('mcp.kits.import.match.custom');
    expect(rows[3]).toHaveTextContent('mcp.kits.import.match.none');
    // Custom and dropped servers cannot be picked here.
    expect(within(rows[2] as HTMLElement).getByRole('checkbox')).toBeDisabled();
    expect(within(rows[3] as HTMLElement).getByRole('checkbox')).toBeDisabled();
  });

  it('defaults to tb-<template> names, production and read, and imports exactly the picked servers', async () => {
    renderModal();
    await screen.findAllByTestId('kit-import-row');

    expect(screen.getByRole('textbox', { name: 'mcp.kits.import.instanceNameLabel|{"name":"paddle"}' })).toHaveValue(
      'tb-paddle'
    );
    fireEvent.change(screen.getByRole('textbox', { name: 'mcp.kits.import.instanceNameLabel|{"name":"supabase"}' }), {
      target: { value: 'tb-supabase-prod' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'mcp.kits.import.submit|{"count":2}' }));

    await waitFor(() =>
      expect(api.kits.importKeys.invoke).toHaveBeenCalledWith({
        project_id: 'proj-tb',
        data: {
          servers: [
            {
              name: 'paddle',
              template_id: 'paddle',
              instance_name: 'tb-paddle',
              environment: 'production',
              tier: 'read',
            },
            {
              name: 'supabase',
              template_id: 'supabase',
              instance_name: 'tb-supabase-prod',
              environment: 'production',
              tier: 'read',
            },
          ],
        },
      })
    );
  });

  it('blocks an invalid or duplicate instance name and drops unpicked servers', async () => {
    renderModal();
    const rows = await screen.findAllByTestId('kit-import-row');

    const supabaseName = screen.getByRole('textbox', { name: 'mcp.kits.import.instanceNameLabel|{"name":"supabase"}' });
    fireEvent.change(supabaseName, { target: { value: 'tb-paddle' } });
    // Both rows now share a name: each shows the problem.
    expect(await screen.findAllByText('mcp.kits.import.nameProblem.taken')).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'mcp.kits.import.submit|{"count":2}' })).toBeDisabled();

    fireEvent.change(supabaseName, { target: { value: 'Bad Name' } });
    expect(await screen.findByText('mcp.kits.import.nameProblem.pattern')).toBeInTheDocument();

    fireEvent.click(within(rows[1] as HTMLElement).getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'mcp.kits.import.submit|{"count":1}' }));
    await waitFor(() => expect(api.kits.importKeys.invoke).toHaveBeenCalled());
    expect(api.kits.importKeys.invoke.mock.calls[0]?.[0].data.servers.map((s: { name: string }) => s.name)).toEqual([
      'paddle',
    ]);
  });

  it('shows results: missing keys keep Test disabled, failures explain their code, Test reports tools', async () => {
    api.kits.importKeys.invoke.mockResolvedValueOnce({
      kit_id: 'kit-tb',
      servers: [
        { name: 'paddle', instance_id: 'inst-pdl', error_code: null, missing_secrets: [] },
        {
          name: 'supabase',
          instance_id: null,
          error_code: 'MCP_MARKET_INVALID',
          message: 'SUPABASE_PROJECT_REF is required',
          missing_secrets: [],
        },
      ],
    });
    renderModal();
    await screen.findAllByTestId('kit-import-row');
    fireEvent.click(screen.getByRole('button', { name: 'mcp.kits.import.submit|{"count":2}' }));

    const results = await screen.findAllByTestId('kit-import-result');
    expect(results[0]).toHaveTextContent('mcp.kits.import.created|{"name":"tb-paddle"}');
    expect(results[1]).toHaveTextContent(
      'mcp.kits.import.errors.invalid|{"detail":"SUPABASE_PROJECT_REF is required"}'
    );

    fireEvent.click(within(results[0] as HTMLElement).getByRole('button', { name: /mcp\.kits\.import\.testLabel/ }));
    await waitFor(() =>
      expect(api.testMcpConnection.invoke).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'inst-pdl', name: 'tb-paddle', runtime_scope_id: 'inst-pdl' })
      )
    );
    expect(await within(results[0] as HTMLElement).findByRole('status')).toHaveTextContent(
      'mcp.kits.import.testOk|{"count":2}'
    );
  });

  it('keeps Test off for an instance created without its keys and names the missing ones', async () => {
    renderModal();
    await screen.findAllByTestId('kit-import-row');
    fireEvent.click(screen.getByRole('button', { name: 'mcp.kits.import.submit|{"count":2}' }));

    const results = await screen.findAllByTestId('kit-import-result');
    expect(results[1]).toHaveTextContent('mcp.kits.import.missingSecrets|{"fields":"SUPABASE_DB_PASSWORD"}');
    expect(
      within(results[1] as HTMLElement).getByRole('button', { name: /mcp\.kits\.import\.testLabel/ })
    ).toBeDisabled();
  });

  it('says so when the project has no .mcp.json', async () => {
    api.kits.importPreview.invoke.mockResolvedValue({ project_id: 'proj-tb', file_found: false, servers: [] });
    renderModal();

    expect(await screen.findByTestId('kit-import-no-file')).toHaveTextContent('mcp.kits.import.noFile');
    expect(screen.getByRole('button', { name: 'mcp.kits.import.submit|{"count":0}' })).toBeDisabled();
  });
});
