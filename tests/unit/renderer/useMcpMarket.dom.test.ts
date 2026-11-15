/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * MCP market hook (card C15): loads the market and sends each action to the
 * right `/api/mcp/market/*` call (attach/detach, approval before activation,
 * secrets after create, test-connection by id), reloading afterwards.
 */

import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => {
  const fn = () => ({ invoke: vi.fn() });
  return {
    market: {
      listTemplates: fn(),
      listInstances: fn(),
      listAssignments: fn(),
      getStatus: fn(),
      createInstance: fn(),
      updateInstance: fn(),
      deleteInstance: fn(),
      duplicateInstance: fn(),
      revokeInstance: fn(),
      refreshTemplate: fn(),
      setApproval: fn(),
      setSecret: fn(),
      clearSecret: fn(),
      createAssignments: fn(),
      deleteAssignment: fn(),
    },
    testMcpConnection: fn(),
    assistantsList: fn(),
  };
});

vi.mock('@/common/adapter/ipcBridge', () => ({
  mcpService: { market: api.market, testMcpConnection: api.testMcpConnection },
}));

vi.mock('@/common', () => ({
  ipcBridge: { assistants: { list: api.assistantsList } },
}));

import { useMcpMarket } from '@/renderer/hooks/mcp/market/useMcpMarket';
import type { McpMarketInstance } from '@/common/config/storage';

const instance = { id: 'i1', name: 'tb-x', created_at: 1, updated_at: 2 } as McpMarketInstance;

const loaded = async () => {
  const hook = renderHook(() => useMcpMarket());
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  return hook;
};

beforeEach(() => {
  vi.clearAllMocks();
  api.market.listTemplates.invoke.mockResolvedValue([{ id: 'paddle' }]);
  api.market.listInstances.invoke.mockResolvedValue([instance]);
  api.market.listAssignments.invoke.mockResolvedValue([]);
  api.market.getStatus.invoke.mockResolvedValue({ instances: [{ id: 'i1', problems: ['x'] }] });
  api.assistantsList.invoke.mockResolvedValue([{ id: 'a1', name: 'Writer' }]);
});

describe('useMcpMarket', () => {
  it('loads templates, instances, assignments, status and assistants', async () => {
    const { result } = await loaded();
    expect(result.current.templates).toEqual([{ id: 'paddle' }]);
    expect(result.current.instances).toEqual([instance]);
    expect(result.current.health.i1.problems).toEqual(['x']);
    expect(result.current.assistants.map((a) => a.id)).toEqual(['a1']);
    expect(result.current.error).toBeNull();
  });

  it('reports a load failure, and a catalogue failure separately', async () => {
    const boom = new Error('down');
    api.market.listInstances.invoke.mockRejectedValue(boom);
    api.market.listTemplates.invoke.mockRejectedValue(new Error('no catalogue'));
    const { result } = await loaded();
    expect(result.current.error).toBe(boom);
    expect((result.current.templatesError as Error).message).toBe('no catalogue');
  });

  it('attaches with one request per scope (CLIs in the body) and detaches every assignment id', async () => {
    api.market.createAssignments.invoke.mockResolvedValue([]);
    api.market.deleteAssignment.invoke.mockResolvedValue(undefined);
    const { result } = await loaded();

    await act(() =>
      result.current.attach({ instance_id: 'i1', project_id: 'p1', assistant_id: 'a1', clis: ['claude', 'codex'] })
    );
    expect(api.market.createAssignments.invoke).toHaveBeenCalledWith({
      instance_id: 'i1',
      project_id: 'p1',
      assistant_id: 'a1',
      clis: ['claude', 'codex'],
    });

    await act(() => result.current.detach(['as1', 'as2']));
    expect(api.market.deleteAssignment.invoke.mock.calls).toEqual([[{ id: 'as1' }], [{ id: 'as2' }]]);
    // Each action reloads (initial load + 2).
    expect(api.market.listAssignments.invoke).toHaveBeenCalledTimes(3);
  });

  it('records the approval before activating, and activates directly without one', async () => {
    const order: string[] = [];
    api.market.setApproval.invoke.mockImplementation(async () => order.push('approval'));
    api.market.updateInstance.invoke.mockImplementation(async () => {
      order.push('active');
      return instance;
    });
    const { result } = await loaded();

    await act(() => result.current.activate('i1', 'OA-20261115-x'));
    expect(api.market.setApproval.invoke).toHaveBeenCalledWith({ id: 'i1', approval_ref: 'OA-20261115-x' });
    expect(api.market.updateInstance.invoke).toHaveBeenCalledWith({ id: 'i1', data: { status: 'active' } });
    expect(order).toEqual(['approval', 'active']);

    api.market.setApproval.invoke.mockClear();
    await act(() => result.current.activate('i1'));
    expect(api.market.setApproval.invoke).not.toHaveBeenCalled();
  });

  it('sets non-empty secrets once the instance exists, and still reloads when a call fails', async () => {
    api.market.createInstance.invoke.mockResolvedValue({ ...instance, id: 'new' });
    api.market.setSecret.invoke.mockResolvedValue({});
    const { result } = await loaded();

    await act(async () => {
      await result.current.createInstance(
        { name: 'tb-x', template_id: 'paddle', environment: 'sandbox', tier: 'read', clis: ['claude'] },
        { API_KEY: 'fake-value', EMPTY: '' }
      );
    });
    expect(api.market.setSecret.invoke).toHaveBeenCalledTimes(1);
    expect(api.market.setSecret.invoke).toHaveBeenCalledWith({ id: 'new', key: 'API_KEY', value: 'fake-value' });

    api.market.revokeInstance.invoke.mockRejectedValue(new Error('refused'));
    const before = api.market.listInstances.invoke.mock.calls.length;
    await expect(act(() => result.current.revoke('i1'))).rejects.toThrow('refused');
    expect(api.market.listInstances.invoke.mock.calls.length).toBe(before + 1);
  });

  it('tests a market row by id (the server ignores the client transport)', async () => {
    api.testMcpConnection.invoke.mockResolvedValue({ success: true, tools: [{ name: 'list_prices' }] });
    const { result } = await loaded();
    let outcome: unknown;
    await act(async () => {
      outcome = await result.current.testConnection(instance);
    });
    expect(api.testMcpConnection.invoke).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'i1', name: 'tb-x', runtime_scope_id: 'i1' })
    );
    expect(outcome).toEqual({ kind: 'ok', tools: ['list_prices'] });

    const failure = new Error('timeout');
    api.testMcpConnection.invoke.mockRejectedValue(failure);
    await act(async () => {
      outcome = await result.current.testConnection(instance);
    });
    expect(outcome).toEqual({ kind: 'failed', error: failure });
  });
});
