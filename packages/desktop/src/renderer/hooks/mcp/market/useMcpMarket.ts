/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * MCP market state (card C15): templates, instances, assignments and the rule
 * status from `/api/mcp/market/*`, plus the assistants an instance can be bound
 * to. Every action calls the backend and then reloads, so the view always shows
 * what the server stored; failures are thrown to the caller, which explains
 * them with `describeMarketError`. Secret values pass through `setSecret` only
 * and are never kept in this state.
 */

import { ipcBridge } from '@/common';
import { mcpService } from '@/common/adapter/ipcBridge';
import type {
  IMcpServer,
  McpMarketAssignment,
  McpMarketCreateAssignmentRequest,
  McpMarketCreateInstanceRequest,
  McpMarketInstance,
  McpMarketInstanceHealth,
  McpMarketTemplate,
  McpMarketTemplateRefreshResult,
  McpMarketUpdateInstanceRequest,
} from '@/common/config/storage';
import type { Assistant } from '@/common/types/agent/assistantTypes';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export type McpMarketTestResult = { kind: 'ok'; tools: string[] } | { kind: 'failed'; error: unknown };

export type McpMarketController = {
  templates: McpMarketTemplate[];
  instances: McpMarketInstance[];
  assignments: McpMarketAssignment[];
  health: Record<string, McpMarketInstanceHealth>;
  assistants: Assistant[];
  /** First load in progress (later reloads keep showing the last data). */
  loading: boolean;
  /** Instances or assignments could not be loaded. */
  error: unknown;
  /** The template catalogue could not be loaded (instances may still show). */
  templatesError: unknown;
  reload: () => Promise<void>;
  createInstance: (req: McpMarketCreateInstanceRequest, secrets: Record<string, string>) => Promise<McpMarketInstance>;
  duplicateInstance: (id: string, name: string) => Promise<McpMarketInstance>;
  updateInstance: (id: string, data: McpMarketUpdateInstanceRequest) => Promise<McpMarketInstance>;
  setSecret: (id: string, key: string, value: string) => Promise<void>;
  clearSecret: (id: string, key: string) => Promise<void>;
  /** Record the approval (when given) and then set the instance active. */
  activate: (id: string, approvalRef?: string) => Promise<McpMarketInstance>;
  deactivate: (id: string) => Promise<McpMarketInstance>;
  revoke: (id: string) => Promise<McpMarketInstance>;
  remove: (id: string) => Promise<void>;
  refreshTemplate: (id: string) => Promise<McpMarketTemplateRefreshResult>;
  attach: (req: McpMarketCreateAssignmentRequest) => Promise<McpMarketAssignment[]>;
  detach: (assignmentIds: string[]) => Promise<void>;
  testConnection: (instance: McpMarketInstance) => Promise<McpMarketTestResult>;
};

/**
 * `POST /api/mcp/test-connection {id}` of a market row: the server builds the
 * real transport from the template, plain env and decrypted secrets and ignores
 * the client transport (R1 #12), so only a placeholder is sent.
 */
const testPayload = (instance: McpMarketInstance): IMcpServer & { runtime_scope_id?: string } => ({
  id: instance.id,
  name: instance.name,
  enabled: false,
  transport: { type: 'stdio', command: 'aioncore', args: ['mcp', 'exec', instance.name] },
  created_at: instance.created_at,
  updated_at: instance.updated_at,
  original_json: '{}',
  runtime_scope_id: instance.id,
});

export const useMcpMarket = (): McpMarketController => {
  const [templates, setTemplates] = useState<McpMarketTemplate[]>([]);
  const [instances, setInstances] = useState<McpMarketInstance[]>([]);
  const [assignments, setAssignments] = useState<McpMarketAssignment[]>([]);
  const [healthList, setHealthList] = useState<McpMarketInstanceHealth[]>([]);
  const [assistants, setAssistants] = useState<Assistant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [templatesError, setTemplatesError] = useState<unknown>(null);
  const alive = useRef(true);
  const run = useRef(0);

  const reload = useCallback(async () => {
    const current = ++run.current;
    const [tpl, inst, asg, status, asst] = await Promise.allSettled([
      mcpService.market.listTemplates.invoke(),
      mcpService.market.listInstances.invoke(),
      mcpService.market.listAssignments.invoke(),
      mcpService.market.getStatus.invoke(),
      ipcBridge.assistants.list.invoke(),
    ]);
    // A newer reload (or an unmount) owns the state now.
    if (!alive.current || current !== run.current) return;
    if (tpl.status === 'fulfilled') {
      setTemplates(tpl.value ?? []);
      setTemplatesError(null);
    } else {
      setTemplatesError(tpl.reason);
    }
    if (inst.status === 'fulfilled' && asg.status === 'fulfilled') {
      setInstances(inst.value ?? []);
      setAssignments(asg.value ?? []);
      setError(null);
    } else {
      setError(inst.status === 'rejected' ? inst.reason : (asg as PromiseRejectedResult).reason);
    }
    // Status and assistants are additive: a failure leaves the last known value.
    if (status.status === 'fulfilled') setHealthList(status.value?.instances ?? []);
    if (asst.status === 'fulfilled') setAssistants(asst.value ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    alive.current = true;
    void reload();
    return () => {
      alive.current = false;
    };
  }, [reload]);

  const after = useCallback(
    async <T>(promise: Promise<T>): Promise<T> => {
      try {
        return await promise;
      } finally {
        await reload();
      }
    },
    [reload]
  );

  const createInstance = useCallback(
    (req: McpMarketCreateInstanceRequest, secrets: Record<string, string>) =>
      after(
        (async () => {
          const created = await mcpService.market.createInstance.invoke(req);
          // Secrets belong to the instance, so they are set once it exists.
          await Promise.all(
            Object.entries(secrets)
              .filter(([, value]) => value)
              .map(([key, value]) => mcpService.market.setSecret.invoke({ id: created.id, key, value }))
          );
          return created;
        })()
      ),
    [after]
  );

  const duplicateInstance = useCallback(
    (id: string, name: string) => after(mcpService.market.duplicateInstance.invoke({ id, name })),
    [after]
  );

  const updateInstance = useCallback(
    (id: string, data: McpMarketUpdateInstanceRequest) => after(mcpService.market.updateInstance.invoke({ id, data })),
    [after]
  );

  const setSecret = useCallback(
    async (id: string, key: string, value: string) => {
      await after(mcpService.market.setSecret.invoke({ id, key, value }));
    },
    [after]
  );

  const clearSecret = useCallback(
    async (id: string, key: string) => {
      await after(mcpService.market.clearSecret.invoke({ id, key }));
    },
    [after]
  );

  const activate = useCallback(
    (id: string, approvalRef?: string) =>
      after(
        (async () => {
          if (approvalRef !== undefined) {
            await mcpService.market.setApproval.invoke({ id, approval_ref: approvalRef });
          }
          return mcpService.market.updateInstance.invoke({ id, data: { status: 'active' } });
        })()
      ),
    [after]
  );

  const deactivate = useCallback(
    (id: string) => after(mcpService.market.updateInstance.invoke({ id, data: { status: 'dormant' } })),
    [after]
  );

  const revoke = useCallback((id: string) => after(mcpService.market.revokeInstance.invoke({ id })), [after]);

  const remove = useCallback(
    async (id: string) => {
      await after(mcpService.market.deleteInstance.invoke({ id }));
    },
    [after]
  );

  const refreshTemplate = useCallback((id: string) => after(mcpService.market.refreshTemplate.invoke({ id })), [after]);

  const attach = useCallback(
    (req: McpMarketCreateAssignmentRequest) => after(mcpService.market.createAssignments.invoke(req)),
    [after]
  );

  const detach = useCallback(
    async (assignmentIds: string[]) => {
      await after(Promise.all(assignmentIds.map((id) => mcpService.market.deleteAssignment.invoke({ id }))));
    },
    [after]
  );

  const testConnection = useCallback(
    async (instance: McpMarketInstance): Promise<McpMarketTestResult> => {
      try {
        const result = await mcpService.testMcpConnection.invoke(testPayload(instance));
        if (result.success) return { kind: 'ok', tools: (result.tools ?? []).map((tool) => tool.name) };
        return { kind: 'failed', error: result };
      } catch (err) {
        return { kind: 'failed', error: err };
      } finally {
        // The server stored the tools it saw (they feed the allow/block lists).
        await reload();
      }
    },
    [reload]
  );

  const health = useMemo(() => Object.fromEntries(healthList.map((h) => [h.id, h])), [healthList]);

  return {
    templates,
    instances,
    assignments,
    health,
    assistants,
    loading,
    error,
    templatesError,
    reload,
    createInstance,
    duplicateInstance,
    updateInstance,
    setSecret,
    clearSecret,
    activate,
    deactivate,
    revoke,
    remove,
    refreshTemplate,
    attach,
    detach,
    testConnection,
  };
};
