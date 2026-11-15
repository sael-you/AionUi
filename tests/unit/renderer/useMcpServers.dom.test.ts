/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * The legacy MCP list leaves out the MCP market catalogue: its extension
 * entries are templates, listed by the market view (card C15, R1 #16).
 */

import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/common', () => ({
  ipcBridge: {
    extensions: {
      getMcpServers: {
        invoke: vi.fn(() =>
          Promise.resolve([
            {
              id: 'ext-studio-mcp-catalog-paddle',
              name: 'paddle',
              transport: { type: 'stdio', command: 'npx' },
              _source: 'extension',
              _extensionName: 'studio-mcp-catalog',
            },
            {
              id: 'ext-other-tool',
              name: 'tool',
              transport: { type: 'stdio', command: 'tool' },
              _source: 'extension',
              _extensionName: 'other',
            },
          ])
        ),
      },
    },
  },
}));

vi.mock('@/renderer/hooks/mcp/catalog', () => ({
  ensureBackendMcpCatalog: () => Promise.resolve({ userServers: [], builtinServers: [], allServers: [] }),
}));

import { useMcpServers } from '@/renderer/hooks/mcp/useMcpServers';

describe('useMcpServers', () => {
  it('drops studio-mcp-catalog templates from the extension servers', async () => {
    const { result } = renderHook(() => useMcpServers());
    await waitFor(() => expect(result.current.extensionMcpServers).toHaveLength(1));
    expect(result.current.extensionMcpServers[0].id).toBe('ext-other-tool');
  });
});
