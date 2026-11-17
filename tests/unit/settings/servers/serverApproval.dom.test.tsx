/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { SWRConfig } from 'swr';
import { afterEach, describe, expect, it, vi } from 'vitest';

const classify = vi.hoisted(() => vi.fn());

vi.mock('@/common', () => ({ ipcBridge: { servers: { classify: { invoke: classify } } } }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => (options ? `${key}|${JSON.stringify(options)}` : key),
  }),
}));

import {
  ServerCommandContext,
  serverCommandOf,
} from '@/renderer/pages/conversation/Messages/components/MessagePermission/serverCommand';

const renderContext = () =>
  render(
    <SWRConfig value={{ provider: () => new Map() }}>
      <ServerCommandContext request={{ server: 'db-prod', command: 'systemctl restart api' }} />
    </SWRConfig>
  );

describe('crucial server command approval (C36, TASK-97 ask path)', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('recognises run_command on the crucial servers MCP only', () => {
    const args = { server: 'db-prod', command: 'rm -rf /tmp/x' };
    expect(serverCommandOf('mcp__aionui-servers-crucial__run_command', args)).toEqual(args);
    expect(serverCommandOf('Run', { ...args, server_name: 'aionui-servers-crucial' })).toEqual(args);
    // The standard channel never asks; other tools and incomplete args are left alone.
    expect(serverCommandOf('mcp__aionui-servers__run_command', args)).toBeNull();
    expect(serverCommandOf('mcp__aionui-servers-crucial__list_servers', {})).toBeNull();
    expect(serverCommandOf('mcp__aionui-servers-crucial__run_command', { server: 'db-prod' })).toBeNull();
    expect(serverCommandOf(undefined, undefined)).toBeNull();
  });

  it('shows the server, its environment and tier, and the rule that made it crucial — from core', async () => {
    classify.mockResolvedValue({
      crucial: true,
      reason: 'restarts a service',
      environment: 'production',
      tier: 'write',
    });
    renderContext();
    expect(screen.getByText('db-prod')).toBeInTheDocument();
    expect(await screen.findByTestId('server-approval-reason')).toHaveTextContent(
      'messages.serverApproval.reason|{"reason":"restarts a service"}'
    );
    expect(screen.getByText('mcp.market.environment.production|{"defaultValue":"production"}')).toBeInTheDocument();
    expect(classify).toHaveBeenCalledWith({ server: 'db-prod', command: 'systemctl restart api' });
  });

  it('says so when only the agent called it crucial', async () => {
    classify.mockResolvedValue({ crucial: false, environment: 'production', tier: 'write' });
    renderContext();
    expect(await screen.findByTestId('server-approval-reason')).toHaveTextContent(
      'messages.serverApproval.declaredByAgent'
    );
  });

  it('still shows the server when core cannot classify', async () => {
    classify.mockRejectedValue(new Error('offline'));
    renderContext();
    await waitFor(() => expect(classify).toHaveBeenCalled());
    expect(screen.getByText('db-prod')).toBeInTheDocument();
    expect(screen.queryByTestId('server-approval-reason')).toBeNull();
  });
});
